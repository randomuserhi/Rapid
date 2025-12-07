import { transformAsync } from "@babel/core";
import Chokidar, { FSWatcher } from "chokidar";
import File from "fs/promises";
import Path from "path";
import Ts from "typescript";
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";

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

interface PackageInfo {
    /** package name */
    pckg: string;

    /** version name */
    version: string;

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
     * Resolves a package name and version to its actual location on disk.
     * If there is a conflict, prioritises the first occurence. 
     * Priority is order of directories, where firstmost is given highest priority.
     * 
     * @param pckg Package name
     * @param version Version name
     * @returns Package info or undefined if the package is not found
     */
    public async get(pckg: string, version: string): Promise<PackageInfo | undefined> {
        for (const dir of this.directories) {
            const baseDir = Path.resolve(Path.join(dir, pckg, version));
            const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
            const configStat = await fileStat(configPath);

            if (configStat !== undefined && configStat.isFile()) {
                return {
                    pckg,
                    version,
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
        const version = parts[2];
        
        const baseDir = Path.resolve(Path.join(dir, pckg, version));
        const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
        const configStat = await fileStat(configPath);

        if (configStat !== undefined && configStat.isFile()) {
            return {
                pckg,
                version,
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
    constructor(pckg: string, version: string) {
        super(`Package '${pckg}/${version}' was not found.`);
        this.name = "PackageErrorNotFound";
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PackageNotFoundError);
        }
    }
}

/**
 * Package config
 */
interface PackageConfig {
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

function reportWatchStatusChanged(diagnostic: Ts.Diagnostic) {
    //console.info(Ts.formatDiagnostic(diagnostic, formatHost));
}

class PackageBuilder {
    private readonly host: Ts.SolutionBuilderWithWatchHost<Ts.SemanticDiagnosticsBuilderProgram> = undefined!;
    private readonly fileWatchers = new Set<Ts.FileWatcher>();

    public onASLTranspiled: ((path: string) => void) | undefined;

    private builder: Ts.SolutionBuilder<Ts.SemanticDiagnosticsBuilderProgram> | undefined = undefined;

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
            reportWatchStatusChanged
        );

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

                // TODO(randomuserhi): Trigger hot reload hook for newly compiled file
                this.onASLTranspiled?.(fileName);
            } break;

            default: {
                origWriteFile?.(fileName, data, writeByteOrderMark);
            } break;
            }
        };
    }

    public start(rootNames: readonly string[]) {
        if (rootNames.length === 0) return;

        // Start the typescript compiler
        this.builder = Ts.createSolutionBuilderWithWatch(this.host, rootNames, {});
        this.builder.build();
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

    /**
     * 
     * @param registry Registry of packages
     * @param typeDir Directory of standard library types such as "@types/node"
     */
    constructor(registry: PackageRegistry, typeDir: string) {
        this.registry = registry;
        this.typeDir = typeDir;

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
    
    private startAutomaticBuilds() {
        if (this.watchList.length === 0) return;
        this.builder.start(this.watchList);

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

    private async _make(pckgInfo: PackageInfo) {
        // Stop the builder
        this.stopAutomaticBuilds();

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

            for (const dependency in pckgConfig.dependencies) {
                if (dependency === pckgInfo.pckg) continue; // Skip dependency on self

                const depVersion = pckgConfig.dependencies[dependency];

                jobs.push(
                    this.registry.get(dependency, depVersion)
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
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/${dependency.version}/*`] = [
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
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/${dependency.version}/*`] = [
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
                        ]
                    }
                }
            };

            // Add dependency paths
            const references: Ts.ProjectReference[] = [];
            for (const dependency of dependencies) {
                repoTsconfig.compilerOptions!.paths![`${dependency.pckg}/${dependency.version}/*`] = [
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
        this.startAutomaticBuilds();
    }

    /** Makes the package, initializing the required tsconfigs */
    public async make(pckg: string, version: string) {
        const pckgInfo = await this.registry.get(pckg, version);
        if (pckgInfo === undefined) throw new PackageNotFoundError(pckg, version);
        
        await this._make(pckgInfo);
    }

    /** Adds a package to watch list - automatically makes the package and builds it on changes. */
    public async watch(pckg: PackageInfo): Promise<void>

    /** Adds a package to watch list - automatically makes the package and builds it on changes. */
    public async watch(pckg: string, version: string): Promise<void>
    
    public async watch(pckg: string | PackageInfo, version?: string) {
        let pckgInfo: string | PackageInfo | undefined = pckg;
        if (typeof pckgInfo === "string") {
            const pckgName = pckgInfo;
            pckgInfo = await this.registry.get(pckgInfo, version!);
            if (pckgInfo === undefined) throw new PackageNotFoundError(pckgName, version!);
        }

        const index = this.watchList.findIndex((rootName) => rootName === pckgInfo.baseDir);
        if (index < 0) {
            this.stopAutomaticBuilds();

            this.watchList.push(pckgInfo.baseDir);

            this.startAutomaticBuilds();
        }
    }

    /** Removes a package from the watch list */
    public async unwatch(pckg: string, version: string) {
        const pckgInfo = await this.registry.get(pckg, version);
        if (pckgInfo === undefined) throw new PackageNotFoundError(pckg, version);

        const index = this.watchList.findIndex((rootName) => rootName === pckgInfo.baseDir);
        if (index >= 0) {
            this.stopAutomaticBuilds();

            this.watchList.splice(index, 1);

            this.startAutomaticBuilds();
        }
    }

    
    /** Builds the given package */
    public async build(pckg: PackageInfo): Promise<void>

    /** Builds the given package */
    public async build(pckg: string, version: string): Promise<void>
    
    public async build(pckg: string | PackageInfo, version?: string) {
        let pckgInfo: string | PackageInfo | undefined = pckg;
        if (typeof pckgInfo === "string") {
            const pckgName = pckgInfo;
            pckgInfo = await this.registry.get(pckgInfo, version!);
            if (pckgInfo === undefined) throw new PackageNotFoundError(pckgName, version!);
        }

        await this._make(pckgInfo);

        const host = Ts.createSolutionBuilderHost(
            Ts.sys,
            Ts.createSemanticDiagnosticsBuilderProgram,
            reportDiagnostic,
            reportSolutionStatusChanged
        );

        // Overwrite behaviour for babel transpilation of asl files
        const origWriteFile = host.writeFile;
        host.writeFile = async (fileName, data, writeByteOrderMark) => {
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

        const builder = Ts.createSolutionBuilder(host, [pckgInfo.baseDir], {});
        builder.build();
    }
}