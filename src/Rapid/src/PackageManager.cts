import { transformAsync } from "@babel/core";
import Chokidar, { FSWatcher } from "chokidar";
import File from "fs/promises";
import Path from "path";
import Ts from "typescript";
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";
import { PromiseResult } from "./PromiseResult.cjs";

/** Helper method to get file information. Returns undefined if file does not exist. */
async function fileStat(path: string) {
    try {
        const stats = await File.stat(path);
        return stats;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return undefined;
        }
        throw err; // real unexpected error
    }
}

/** 
 * Generates a path relative to the base directory.
 * Inserts "./" to the front, which Path.relative does not do.
 */
function relPath(baseDir: string, path: string) {
    return `.${Path.sep}${Path.relative(baseDir, path)}`;
}

const RAPID_CONFIG_NAME = "rapid.config.json";

export interface PackageInfo {
    /** package name */
    pckg: string;

    /** Package base directory */
    baseDir: string;

    /** Config path */
    configPath: string;
}

/**
 * Manages the directories that exist in a registry and abstracts them behind
 * a single interface.
 */
export class PackageRegistry {
    private readonly directories: string[];

    constructor(directories: string[]) {
        this.directories = directories;
    }

    /**
     * Resolves a package name to its actual location on disk.
     * If there is a conflict, prioritises the first occurence. 
     * Priority is order of directories, where firstmost is given highest priority.
     * 
     * @param pckg Package name
     * @returns Package info or undefined if the package is not found
     */
    public async get(pckg: string): Promise<PackageInfo | undefined> {
        for (const dir of this.directories) {
            const baseDir = Path.resolve(Path.join(dir, pckg));
            const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
            const configStat = await fileStat(configPath);

            if (configStat !== undefined && configStat.isFile()) {
                return {
                    pckg,
                    baseDir,
                    configPath
                };
            }
        }

        return undefined;
    }

    public async fromPath(path: string): Promise<PackageInfo | undefined> {
        path = Path.resolve(path);

        const basename = Path.basename(path);
        if (basename !== RAPID_CONFIG_NAME) return undefined;

        const dirIndex = this.directories.findIndex(dir => path.startsWith(Path.resolve(dir)));
        if (dirIndex < 0) return undefined;

        const dir = this.directories[dirIndex];
        const parts = path.replace(dir, "").split(Path.sep);
        const pckg = parts[1];

        const baseDir = Path.resolve(Path.join(dir, pckg));
        const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
        const configStat = await fileStat(configPath);

        if (configStat !== undefined && configStat.isFile()) {
            return {
                pckg,
                baseDir,
                configPath
            };
        }

        return undefined;
    }
}

/**
 * Error that happens when package is not found
 */
export class PackageNotFoundError extends Error {
    constructor(pckg: string) {
        super(`Package '${pckg}' was not found.`);
        this.name = "PackageErrorNotFound";
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PackageNotFoundError);
        }
    }
}

/**
 * Package config
 */
export interface PackageConfig {
    back?: {
        cts?: boolean;
        mts?: boolean;
        entry?: string;
    };
    flex?: any;
    front?: {
        mts?: boolean;
        entry?: string;
    };
    dependencies?: Record<string, string>;
}

/**
 * Typescript config
 */
interface TsConfig {
    files?: string[];
    extends?: string;
    compilerOptions?: Ts.CompilerOptions;
    references?: Ts.ProjectReference[];
    include?: string[];
}

const formatHost: Ts.FormatDiagnosticsHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: Ts.sys.getCurrentDirectory,
    getNewLine: () => Ts.sys.newLine
};

function reportDiagnostic(diagnostic: Ts.Diagnostic) {
    //console.error("Error", diagnostic.code, ":", Ts.flattenDiagnosticMessageText(diagnostic.messageText, formatHost.getNewLine()));
}

function reportSolutionStatusChanged(diagnostic: Ts.Diagnostic) {
    //console.info(Ts.formatDiagnostic(diagnostic, formatHost));
}

class PackageBuilder {
    private readonly host: Ts.SolutionBuilderWithWatchHost<Ts.SemanticDiagnosticsBuilderProgram> = undefined!;
    private readonly fileWatchers = new Set<Ts.FileWatcher>();

    public onASLTranspiled: ((files: string[]) => void) | undefined;
    private resolve?: () => void;

    private builder: Ts.SolutionBuilder<Ts.SemanticDiagnosticsBuilderProgram> | undefined = undefined;

    // Watch Typescript build status to trigger hot reload events
    private ASLTranspileJobs: PromiseResult<string>[] = [];
    private reportStatusChanged(diagnostic: Ts.Diagnostic, newLine: string, options: Ts.CompilerOptions, errorCount?: number) {
        if (diagnostic.code === 6194) {
            if (errorCount === undefined || errorCount === 0) {
                // Wait until transpilation finishes
                Promise.all(this.ASLTranspileJobs).then(results => {
                    // Collect succesfully transpiled paths
                    const paths: string[] = [];
                    for (const result of results) {
                        if (result.ok()) paths.push(result.item);
                    }

                    // Trigger callback on all paths
                    this.onASLTranspiled?.(paths);

                    // Signal end of build
                    this.resolve?.();
                    this.resolve = undefined;
                });

                // Clear jobs
                this.ASLTranspileJobs = [];
            }
        }
    }

    constructor() {
        const self = this;
        const sys: Ts.System = {
            ...Ts.sys,
            watchFile(path, callback, pollingInterval) {
                const watcher = Ts.sys.watchFile!(path, callback, pollingInterval);
                self.fileWatchers.add(watcher);
                return watcher;
            },
            watchDirectory(path, callback, recursive) {
                const watcher = Ts.sys.watchDirectory!(path, callback, recursive);
                self.fileWatchers.add(watcher);
                return watcher;
            }
        };

        this.host = Ts.createSolutionBuilderWithWatchHost(
            sys,
            Ts.createSemanticDiagnosticsBuilderProgram,
            reportDiagnostic,
            reportSolutionStatusChanged,
            this.reportStatusChanged.bind(this)
        );

        // Overwrite behaviour for babel transpilation of asl files
        const origWriteFile = this.host.writeFile;
        this.host.writeFile = (fileName, data, writeByteOrderMark) => {
            const extname = Path.extname(fileName);
            // Only handle `.js` output files and ignore `.cjs` and `.mjs`
            switch (extname) {
            case ".js": {
                this.ASLTranspileJobs.push(PromiseResult<string>((resolve, reject) => {
                    transformAsync(data, ASLBabelConfig).then(babelResult => {
                        if (!babelResult || !babelResult.code) {
                            // Error in transpilation, skip
                            reject();
                            return;
                        }

                        const code = babelResult.code;
                        const commit = () => File.writeFile(fileName, code).then(() => resolve(fileName));

                        const dir = Path.dirname(fileName);
                        if (dir !== Path.parse(dir).root) {
                            File.mkdir(dir, { recursive: true }).then(commit).catch(reject);
                        } else {
                            commit().catch(reject);
                        }
                    });
                }));
            } break;

            default: {
                origWriteFile?.(fileName, data, writeByteOrderMark);
            } break;
            }
        };
    }

    public start(rootNames: readonly string[]): Promise<void> {
        return new Promise((resolve) => {
            if (rootNames.length === 0) resolve();

            // Start the typescript compiler
            this.builder = Ts.createSolutionBuilderWithWatch(this.host, rootNames, {});
            this.builder.build();

            this.resolve = resolve;
        });
    }

    public stop() {
        // Stop all file watchers
        for (const watcher of this.fileWatchers) watcher.close();
        this.fileWatchers.clear();

        // unassign builder
        this.builder = undefined;
    }
}

/**
 * Manages packages within a registry.
 */
export class PackageManager {

    private readonly registry: PackageRegistry;

    private readonly typeDir: string;

    public readonly builder: PackageBuilder = new PackageBuilder();

    private configWatcher: FSWatcher | undefined = undefined;
    private lastChangeTrigger = Date.now();

    private watchList: string[] = [];

    private host: Ts.SolutionBuilderHost<Ts.SemanticDiagnosticsBuilderProgram>;

    /**
     * 
     * @param registry Registry of packages
     * @param typeDir Directory of standard library types such as "@types/node"
     */
    constructor(registry: PackageRegistry, typeDir: string) {
        this.registry = registry;
        this.typeDir = typeDir;

        this.host = Ts.createSolutionBuilderHost(
            Ts.sys,
            Ts.createSemanticDiagnosticsBuilderProgram,
            reportDiagnostic,
            reportSolutionStatusChanged
        );

        // TODO(randomuserhi): Capture transpilation jobs and wait for them to complete
        //                     This is for the correct behaviour when performing single-builds
        //                     Refer to .build method

        // Overwrite behaviour for babel transpilation of asl files
        const origWriteFile = this.host.writeFile;
        this.host.writeFile = async (fileName, data, writeByteOrderMark) => {
            const extname = Path.extname(fileName);
            // Only handle `.js` output files and ignore `.cjs` and `.mjs`
            switch (extname) {
            case ".js": {
                const babelResult = await transformAsync(data, ASLBabelConfig);
                if (!babelResult || !babelResult.code) {
                    // Error in transpilation, skip
                    return;
                }

                const dir = Path.dirname(fileName);
                if (dir !== Path.parse(dir).root) {
                    await File.mkdir(dir, { recursive: true });
                }
                await File.writeFile(fileName, babelResult.code);
            } break;

            default: {
                origWriteFile?.(fileName, data, writeByteOrderMark);
            } break;
            }
        };

        const cleanup = () => {
            this.stopAutomaticBuilds();
        };

        process.on('SIGINT', () => {
            cleanup();
            process.exit(0); // Exit gracefully
        });

        process.on('SIGTERM', () => {
            cleanup();
            process.exit(0);
        });

        // Catch normal process exit
        process.on('exit', () => {
            cleanup();
        });

        // Catch unexpected errors (prevent crash without cleanup)
        process.on('uncaughtException', () => {
            cleanup();
            process.exit(1);
        });

        process.on('unhandledRejection', () => {
            cleanup();
            process.exit(1);
        });
    }

    private stopAutomaticBuilds() {
        this.builder.stop();
        this.configWatcher?.close();
        this.configWatcher = undefined;
    }

    private async startAutomaticBuilds() {
        if (this.watchList.length === 0) return;
        await this.builder.start(this.watchList);

        this.configWatcher = Chokidar.watch(this.watchList.map(p => Path.join(p, RAPID_CONFIG_NAME)), {
            ignoreInitial: true
        });
        this.configWatcher.on("change", (path) => {
            const now = Date.now();
            if (now - this.lastChangeTrigger < 100) return;
            this.lastChangeTrigger = now;

            this.registry.fromPath(path).then(pckgInfo => {
                if (pckgInfo === undefined) return;
                this._make(pckgInfo);
            });
        });
    }

    private async _make(pckgInfo: PackageInfo, stopAutomaticBuild: boolean = true) {
        // Stop the builder
        if (stopAutomaticBuild) this.stopAutomaticBuilds();

        /**
         * Packages are made up of 3 repositories (repos):
         * - back => This is for backend code that runs on NodeJS
         * - front => This is for frontend code that runs on browser
         * - flex => This is for code that can run in both backend or frontend
         * 
         * A package must contain atleast one of these sub-repos.
         */

        // Get the package config
        const pckgConfig: PackageConfig = JSON.parse(await File.readFile(pckgInfo.configPath, "utf-8"));

        const buildDir = Path.join(pckgInfo.baseDir, ".build"); // out dir for built files
        const typeDir = Path.join(pckgInfo.baseDir, "@types"); // out dir for built types

        // Generate configs

        // Resolve dependency paths
        const dependencies: PackageInfo[] = [];
        if (pckgConfig.dependencies !== undefined) {
            const jobs: Promise<void>[] = [];

            // TODO(randomuserhi): Make dependencies an array not a k,v pair
            for (const dependency in pckgConfig.dependencies) {
                if (dependency === pckgInfo.pckg) continue; // Skip dependency on self

                jobs.push(
                    this.registry.get(dependency)
                        .then(info => {
                            if (info !== undefined) dependencies.push(info);
                        })
                );
            }

            await Promise.all(jobs);
        }

        // Generate the main config
        const tsconfigPath = Path.join(pckgInfo.baseDir, "tsconfig.json");
        const tsconfig: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: relPath(pckgInfo.baseDir, Path.join(buildDir, ".tsbuildinfo"))
            },
            references: []
        };
        // Add sub-repos as reference for typescript to build them as required
        if (pckgConfig.back !== undefined) {
            tsconfig.references!.push({ path: relPath(pckgInfo.baseDir, Path.join(pckgInfo.baseDir, "back", "tsconfig.json")) });
        }
        if (pckgConfig.front !== undefined) {
            tsconfig.references!.push({ path: relPath(pckgInfo.baseDir, Path.join(pckgInfo.baseDir, "front", "tsconfig.json")) });
        }
        if (pckgConfig.flex !== undefined) {
            tsconfig.references!.push({ path: relPath(pckgInfo.baseDir, Path.join(pckgInfo.baseDir, "flex", "tsconfig.json")) });
        }
        await File.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

        // Generate config folder which holds all auto-generated configs for each sub-repo
        const tsconfigDir = Path.join(pckgInfo.baseDir, ".tsconfig");
        await File.mkdir(tsconfigDir, { recursive: true });

        // Generate base config if it doesn't exist
        // This contains optional typescript settings the user can configure
        const tsconfigBasePath = Path.join(tsconfigDir, "tsconfig.base.json");
        if (await fileStat(tsconfigBasePath) === undefined) {
            const tsconfigBase: TsConfig = {
                compilerOptions: {
                    target: Ts.ScriptTarget[Ts.ScriptTarget.ES2021] as any,
                    strict: true,
                    skipLibCheck: true,
                    esModuleInterop: true,
                    noImplicitAny: true,
                    noImplicitThis: true,
                    strictNullChecks: true,
                    strictFunctionTypes: true,
                    forceConsistentCasingInFileNames: true,
                    removeComments: false,
                    sourceMap: false
                }
            };

            await File.writeFile(tsconfigBasePath, JSON.stringify(tsconfigBase, null, 2));
        }

        // Generate configs for each repositories

        if (pckgConfig.flex !== undefined) {
            const repo = "flex";
            const repoDir = Path.join(pckgInfo.baseDir, `${repo}`);

            const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

            // Make the directory
            await File.mkdir(repoDir, { recursive: true });
            // Make config folder
            await File.mkdir(repoTsconfigDir, { recursive: true });

            // Build directories
            const repoBuildDir = Path.join(buildDir, `${repo}`);
            const repoTypeDir = Path.join(typeDir, `${repo}`);

            // Build config paths
            const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
            const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
            const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");

            // Root tsconfig
            const repoTsconfigRoot: TsConfig = {
                files: [],
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(relPath(repoDir, buildDir), `.${repo}.tsbuildinfo`)
                },
                references: [
                    { "path": relPath(repoDir, repoTsconfigASLPath) }
                ]
            };
            await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

            // Repo config
            const repoTsconfig: TsConfig = {
                extends: relPath(repoTsconfigDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022",
                        "DOM"
                    ],
                    types: [],
                    rootDir: relPath(repoTsconfigDir, repoDir),
                    outDir: relPath(repoTsconfigDir, repoBuildDir),
                    declarationDir: relPath(repoTsconfigDir, repoTypeDir),
                    paths: {
                        "*": [
                            Path.join(relPath(repoTsconfigDir, repoDir), "*")
                        ],
                        "rapid": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "front", "rapid.d.ts")),
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "rapid.d.ts"))
                        ],
                        "rapid/*": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "front", "lib", "*")),
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "lib", "*"))
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/*`] = [
                    relPath(repoTsconfigDir, Path.join(dependency.baseDir, "@types", repo, "*"))
                ];
                references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.baseDir, repo, "tsconfig.json")) });
            }

            await File.writeFile(repoTsconfigPath, JSON.stringify(repoTsconfig, null, 2));

            // ASL tsconfig
            const repoTsconfigASL: TsConfig = {
                extends: relPath(repoTsconfigDir, repoTsconfigPath),
                compilerOptions: {
                    module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                    tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(relPath(repoTsconfigDir, repoDir), "**/*.ts")
                ],
                references
            };
            await File.writeFile(repoTsconfigASLPath, JSON.stringify(repoTsconfigASL, null, 2));
        }

        if (pckgConfig.back !== undefined) {
            const repo = "back";
            const repoDir = Path.join(pckgInfo.baseDir, `${repo}`);

            const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

            // Make the directory
            await File.mkdir(repoDir, { recursive: true });
            // Make config folder
            await File.mkdir(repoTsconfigDir, { recursive: true });

            // Build directories
            const repoBuildDir = Path.join(buildDir, `${repo}`);
            const repoTypeDir = Path.join(typeDir, `${repo}`);

            // Build config paths
            const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
            const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
            const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");
            const repoTsconfigCtsPath = Path.join(repoTsconfigDir, "tsconfig.cjs.json");

            // Does the package allow .cts ?
            const ctsEnabled = pckgConfig.back.cts === true;

            // Root tsconfig
            const repoTsconfigRoot: TsConfig = {
                files: [],
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(relPath(repoDir, buildDir), `.${repo}.tsbuildinfo`)
                },
                references: [
                    { "path": relPath(repoDir, repoTsconfigASLPath) }
                ]
            };
            if (ctsEnabled) {
                repoTsconfigRoot.references!.push({ "path": relPath(repoDir, repoTsconfigCtsPath) });
            }
            await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

            // Repo config
            const repoTsconfig: TsConfig = {
                extends: relPath(repoTsconfigDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022"
                    ],
                    types: [
                        relPath(repoTsconfigDir, Path.join(this.typeDir, "node"))
                    ],
                    rootDir: relPath(repoTsconfigDir, repoDir),
                    outDir: relPath(repoTsconfigDir, repoBuildDir),
                    declarationDir: relPath(repoTsconfigDir, repoTypeDir),
                    paths: {
                        "*": [
                            Path.join(relPath(repoTsconfigDir, repoDir), "*")
                        ],
                        "rapid": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "back", "rapid.d.ts")),
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "rapid.d.ts"))
                        ],
                        "rapid/*": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "back", "lib", "*")),
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "lib", "*"))
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/*`] = [
                    relPath(repoTsconfigDir, Path.join(dependency.baseDir, "@types", repo, "*")),
                    relPath(repoTsconfigDir, Path.join(dependency.baseDir, "@types", "flex", "*"))
                ];
                references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.baseDir, repo, "tsconfig.json")) });
                references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.baseDir, "flex", "tsconfig.json")) });
            }

            // Add flex folder as dependency if it is enabled
            if (pckgConfig.flex !== undefined) {
                const flexPath = Path.join(pckgInfo.baseDir, "flex");

                // Add to main config
                repoTsconfig.compilerOptions!.paths!["*"].push(Path.join(relPath(repoTsconfigDir, flexPath), "*"));

                // Add to reference list
                references.push({ path: relPath(repoTsconfigDir, Path.join(flexPath, "tsconfig.json")) });
            }

            await File.writeFile(repoTsconfigPath, JSON.stringify(repoTsconfig, null, 2));

            // ASL tsconfig
            const repoTsconfigASL: TsConfig = {
                extends: relPath(repoTsconfigDir, repoTsconfigPath),
                compilerOptions: {
                    module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                    tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(relPath(repoTsconfigDir, repoDir), "**/*.ts"),
                    Path.join(relPath(repoTsconfigDir, Path.join(pckgInfo.baseDir, "flex")), "**/*.ts")
                ],
                references
            };
            await File.writeFile(repoTsconfigASLPath, JSON.stringify(repoTsconfigASL, null, 2));

            if (ctsEnabled) {
                // CTS tsconfig
                const repoTsconfigCts: TsConfig = {
                    extends: relPath(repoTsconfigDir, repoTsconfigPath),
                    compilerOptions: {
                        module: Ts.ModuleKind[Ts.ModuleKind.NodeNext] as any,
                        moduleResolution: Ts.ModuleResolutionKind[Ts.ModuleResolutionKind.NodeNext] as any,
                        tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".cts.tsbuildinfo")),
                    },
                    include: [
                        Path.join(relPath(repoTsconfigDir, repoDir), "**/*.cts"),
                        Path.join(relPath(repoTsconfigDir, Path.join(pckgInfo.baseDir, "flex")), "**/*.cts")
                    ],
                    references
                };

                await File.writeFile(repoTsconfigCtsPath, JSON.stringify(repoTsconfigCts, null, 2));
            }
        }

        if (pckgConfig.front !== undefined) {
            const repo = "front";
            const repoDir = Path.join(pckgInfo.baseDir, `${repo}`);

            const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

            // Make the directory
            await File.mkdir(repoDir, { recursive: true });
            // Make config folder
            await File.mkdir(repoTsconfigDir, { recursive: true });

            // Build directories
            const repoBuildDir = Path.join(buildDir, `${repo}`);
            const repoTypeDir = Path.join(typeDir, `${repo}`);

            // Build config paths
            const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
            const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
            const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");
            const repoTsconfigMtsPath = Path.join(repoTsconfigDir, "tsconfig.mjs.json");

            // Does the package allow .cts ?
            const mtsEnabled = pckgConfig.front.mts === true;

            // Root tsconfig
            const repoTsconfigRoot: TsConfig = {
                files: [],
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(relPath(repoDir, buildDir), `.${repo}.tsbuildinfo`)
                },
                references: [
                    { "path": relPath(repoDir, repoTsconfigASLPath) }
                ]
            };
            if (mtsEnabled) {
                repoTsconfigRoot.references!.push({ "path": relPath(repoDir, repoTsconfigMtsPath) });
            }
            await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

            // Repo config
            const repoTsconfig: TsConfig = {
                extends: relPath(repoTsconfigDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022",
                        "DOM"
                    ],
                    types: [],
                    rootDir: relPath(repoTsconfigDir, repoDir),
                    outDir: relPath(repoTsconfigDir, repoBuildDir),
                    declarationDir: relPath(repoTsconfigDir, repoTypeDir),
                    paths: {
                        "*": [
                            Path.join(relPath(repoTsconfigDir, repoDir), "*")
                        ],
                        "rapid": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "rapid.d.ts"))
                        ],
                        "rapid/*": [
                            relPath(repoTsconfigDir, Path.join(this.typeDir, "rapid", "flex", "lib", "*"))
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/*`] = [
                    relPath(repoTsconfigDir, Path.join(dependency.baseDir, "@types", repo, "*")),
                    relPath(repoTsconfigDir, Path.join(dependency.baseDir, "@types", "flex", "*"))
                ];
                references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.baseDir, repo, "tsconfig.json")) });
                references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.baseDir, "flex", "tsconfig.json")) });
            }

            // Add flex folder as dependency if it is enabled
            if (pckgConfig.flex !== undefined) {
                const flexPath = Path.join(pckgInfo.baseDir, "flex");

                // Add to main config
                repoTsconfig.compilerOptions!.paths!["*"].push(Path.join(relPath(repoTsconfigDir, flexPath), "*"));

                // Add to reference list
                references.push({ path: relPath(repoTsconfigDir, Path.join(flexPath, "tsconfig.json")) });
            }

            await File.writeFile(repoTsconfigPath, JSON.stringify(repoTsconfig, null, 2));

            // ASL tsconfig
            const repoTsconfigASL: TsConfig = {
                extends: relPath(repoTsconfigDir, repoTsconfigPath),
                compilerOptions: {
                    module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                    tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(relPath(repoTsconfigDir, repoDir), "**/*.ts"),
                    Path.join(relPath(repoTsconfigDir, Path.join(pckgInfo.baseDir, "flex")), "**/*.ts")
                ],
                references
            };
            await File.writeFile(repoTsconfigASLPath, JSON.stringify(repoTsconfigASL, null, 2));

            if (mtsEnabled) {
                // CTS tsconfig
                const repoTsconfigMts: TsConfig = {
                    extends: relPath(repoTsconfigDir, repoTsconfigPath),
                    compilerOptions: {
                        module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                        tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".mts.tsbuildinfo")),
                    },
                    include: [
                        Path.join(relPath(repoTsconfigDir, repoDir), "**/*.mts"),
                        Path.join(relPath(repoTsconfigDir, Path.join(pckgInfo.baseDir, "flex")), "**/*.mts")
                    ],
                    references
                };

                await File.writeFile(repoTsconfigMtsPath, JSON.stringify(repoTsconfigMts, null, 2));
            }
        }

        // Restart the builder
        if (stopAutomaticBuild) this.startAutomaticBuilds();
    }

    /** Makes the package, initializing the required tsconfigs */
    public async make(pckg: string) {
        const pckgInfo = await this.registry.get(pckg);
        if (pckgInfo === undefined) throw new PackageNotFoundError(pckg);

        await this._make(pckgInfo);
    }

    /** Adds a package to watch list - automatically makes the package and builds it on changes. */
    public async watch(pckg: PackageInfo): Promise<void>

    /** Adds a package to watch list - automatically makes the package and builds it on changes. */
    public async watch(pckg: string): Promise<void>

    public async watch(pckg: string | PackageInfo) {
        let pckgInfo: string | PackageInfo | undefined = pckg;
        if (typeof pckgInfo === "string") {
            const pckgName = pckgInfo;
            pckgInfo = await this.registry.get(pckgInfo);
            if (pckgInfo === undefined) throw new PackageNotFoundError(pckgName);
        }

        const index = this.watchList.findIndex((rootName) => rootName === pckgInfo.baseDir);
        if (index < 0) {
            this.stopAutomaticBuilds();

            this.watchList.push(pckgInfo.baseDir);

            await this.startAutomaticBuilds();
        }
    }

    /** Removes a package from the watch list */
    public async unwatch(pckg: string) {
        const pckgInfo = await this.registry.get(pckg);
        if (pckgInfo === undefined) throw new PackageNotFoundError(pckg);

        const index = this.watchList.findIndex((rootName) => rootName === pckgInfo.baseDir);
        if (index >= 0) {
            this.stopAutomaticBuilds();

            this.watchList.splice(index, 1);

            await this.startAutomaticBuilds();
        }
    }

    // TODO(randomuserhi): These promises should resolve once transpilation completes, not when typescript completes

    /** Builds the given package */
    public async build(pckg: PackageInfo): Promise<void>

    /** Builds the given package */
    public async build(pckg: string): Promise<void>

    public async build(pckg: string | PackageInfo) {
        let pckgInfo: string | PackageInfo | undefined = pckg;
        if (typeof pckgInfo === "string") {
            const pckgName = pckgInfo;
            pckgInfo = await this.registry.get(pckgInfo);
            if (pckgInfo === undefined) throw new PackageNotFoundError(pckgName);
        }

        this.stopAutomaticBuilds();

        await this._make(pckgInfo, false);

        const builder = Ts.createSolutionBuilder(this.host, [pckgInfo.baseDir], {});
        builder.build();

        await this.startAutomaticBuilds();
    }
}