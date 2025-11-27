import { transformAsync } from "@babel/core";
import Chokidar from "chokidar";
import File from "fs/promises";
import Path from "path";
import Typescript, { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";

// TODO(randomuserhi): Fix the below diagnostic functions for typescript errors

const formatHost: Typescript.FormatDiagnosticsHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: Typescript.sys.getCurrentDirectory,
    getNewLine: () => Typescript.sys.newLine
};

function reportDiagnostic(diagnostic: Typescript.Diagnostic) {
    //console.error("Error", diagnostic.code, ":", Typescript.flattenDiagnosticMessageText(diagnostic.messageText, formatHost.getNewLine()));
}

function reportSolutionStatusChanged(diagnostic: Typescript.Diagnostic) {
    //console.info(Typescript.formatDiagnostic(diagnostic, formatHost));
}

function reportWatchStatusChanged(diagnostic: Typescript.Diagnostic) {
    //console.info(Typescript.formatDiagnostic(diagnostic, formatHost));
}

async function pathStat(path: string) {
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

async function readJSON<T>(path: string, defaultValue: T): Promise<T> {
    return File.readFile(path, "utf-8").then((data) => JSON.parse(data)).catch(() => defaultValue);
}

interface RapidConfig {
    back?: {
        allowCts?: boolean;
        entry?: string;
    };
    flex?: any;
    front?: {
        allowMts?: boolean;
        entry?: string;
    };
    dependencies?: Record<string, string>;
}

interface TsConfig {
    files?: string[];
    extends?: string;
    compilerOptions?: Typescript.CompilerOptions;
    references?: Typescript.ProjectReference[];
    include?: string[];
}

const RAPID_CONFIG_NAME = "rapid.config.json";

export interface PackageManagerOptions {
    refresh?: boolean;
}

export class PackageManager {
    private readonly typeDir: string;
    private readonly directories: string[];

    private host: Typescript.SolutionBuilderWithWatchHost<Typescript.SemanticDiagnosticsBuilderProgram> = undefined!;

    private builder: Typescript.SolutionBuilder<Typescript.SemanticDiagnosticsBuilderProgram> = undefined!;

    constructor(directories: string[], typeDir: string, options?: PackageManagerOptions) {
        this.typeDir = typeDir;
        this.directories = directories.map(d => Path.resolve(d));
        this.initialize(options);
    }

    private async parse(rapidConfigPath: string) {
        console.log(`Parsing: ${rapidConfigPath}`);

        const baseDir = Path.dirname(rapidConfigPath);
        const buildDir = Path.join(baseDir, ".build");
        const typeDir = Path.join(baseDir, "@types");
        const tsconfigPath = Path.join(baseDir, "tsconfig.json");

        const config: RapidConfig = JSON.parse(await File.readFile(rapidConfigPath, "utf-8"));

        // Resolve dependencies
        // TODO(randomuserhi): Resolve out of multiple directories given (on conflict, ignore) -> right now just finds first directory that matches
        // TODO(randomuserhi): Skip repeats (same dependency mentioned twice), version invariant (you cannot depend on two different versions of the same package)
        // TODO(randomuserhi): Throw error and catch it when no path is found for dependency
        // TODO(randomuserhi): Parse and verify dependent package (currently we assume its constructed and built properly - which ig is fine?)
        const dependencies: { name: string, path: string }[] = [];
        if (config.dependencies !== undefined) {
            for (const dependency in config.dependencies) {
                const version = config.dependencies[dependency];

                let path: string | undefined = undefined;
                for (const directory of this.directories) {
                    const p = Path.join(directory, dependency, version);
                    const stat = await pathStat(p);
                    if (stat !== undefined && stat.isDirectory()) {
                        path = p;
                        break;
                    }
                }
                if (path === undefined) continue;

                dependencies.push({ name: dependency, path });
            }
        }

        // Generate package `tsconfig.json`
        const tsconfig: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: Path.join(Path.relative(baseDir, buildDir), ".tsbuildinfo")
            },
            references: []
        };

        console.log("Generating back, flex and front...");

        // generate base config
        const tsconfigDir = Path.join(baseDir, ".tsconfig");
        const tsconfigBasePath = Path.join(tsconfigDir, "tsconfig.base.json");

        await File.mkdir(tsconfigDir, { recursive: true });

        const tsconfigBase: TsConfig = {
            compilerOptions: {
                target: ScriptTarget[ScriptTarget.ES2021] as any,
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

        // Generate back, flex and front sub-repos

        if (config.back !== undefined) {
            const _name = "back";
            const backDir = Path.join(baseDir, `${_name}`);
            const backBuildDir = Path.join(buildDir, `${_name}`);
            const backTypeDir = Path.join(typeDir, `${_name}`);

            const tsconfigBackDir = Path.join(tsconfigDir, `${_name}`);

            const tsconfigRootPath = Path.join(backDir, "tsconfig.json");
            const tsconfigBackPath = Path.join(tsconfigBackDir, `tsconfig.${_name}.json`);
            const tsconfigASLPath = Path.join(tsconfigBackDir, "tsconfig.asl.json");
            const tsconfigCtsPath = Path.join(tsconfigBackDir, "tsconfig.cjs.json");

            // Add back to tsconfig
            if (!tsconfig.references!.some(ref => Path.resolve(baseDir, ref.path) === backDir)) {
                tsconfig.references!.push({ path: Path.join(Path.relative(baseDir, backDir), "tsconfig.json") });
            }

            // Make the directory
            await File.mkdir(backDir, { recursive: true });

            // Make config folder
            await File.mkdir(tsconfigBackDir, { recursive: true });

            // main tsconfig
            const tsconfigRoot: TsConfig = {
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(Path.relative(backDir, buildDir), ".tsbuildinfo")
                },
                references: [
                    { "path": Path.relative(backDir, tsconfigASLPath) }
                ]
            };

            // Back tsconfig
            const tsconfigBack: TsConfig = {
                extends: Path.relative(tsconfigBackDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022"
                    ],
                    types: [
                        Path.relative(tsconfigBackDir, Path.join(this.typeDir, "node"))
                    ],
                    rootDir: Path.relative(tsconfigBackDir, backDir),
                    outDir: Path.relative(tsconfigBackDir, backBuildDir),
                    declarationDir: Path.relative(tsconfigBackDir, backTypeDir),
                    paths: {
                        "*": [
                            Path.join(Path.relative(tsconfigBackDir, backDir), "*")
                        ]
                    }
                },
                references: []
            };

            // Add dependency paths
            for (const dependency of dependencies) {
                tsconfigBack.compilerOptions!.paths![`${dependency.name}/*`] = [
                    Path.relative(tsconfigBackDir, Path.join(dependency.path, "@types", _name, "*")),
                    Path.relative(tsconfigBackDir, Path.join(dependency.path, "@types", "flex", "*"))
                ];
                tsconfigBack.references!.push({ path: Path.relative(tsconfigBackDir, Path.join(dependency.path, _name, "tsconfig.json")) });
                tsconfigBack.references!.push({ path: Path.relative(tsconfigBackDir, Path.join(dependency.path, "flex", "tsconfig.json")) });
            }

            await File.writeFile(tsconfigBackPath, JSON.stringify(tsconfigBack, null, 2));

            // ASL tsconfig
            const tsconfigASL: TsConfig = {
                extends: `.${Path.sep}${Path.relative(tsconfigBackDir, tsconfigBackPath)}`,
                compilerOptions: {
                    module: ModuleKind[ModuleKind.ES2022] as any,
                    tsBuildInfoFile: Path.relative(tsconfigBackDir, Path.join(backBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(Path.relative(tsconfigBackDir, backDir), "**/*.ts")
                ]
            };

            await File.writeFile(tsconfigASLPath, JSON.stringify(tsconfigASL, null, 2));

            if (config.back.allowCts) {
                // CTS tsconfig
                const tsconfigCts: TsConfig = {
                    extends: `.${Path.sep}${Path.relative(tsconfigBackDir, tsconfigBackPath)}`,
                    compilerOptions: {
                        module: ModuleKind[ModuleKind.NodeNext] as any,
                        moduleResolution: ModuleResolutionKind[ModuleResolutionKind.NodeNext] as any,
                        tsBuildInfoFile: Path.relative(tsconfigBackDir, Path.join(backBuildDir, ".cts.tsbuildinfo")),
                    },
                    include: [
                        Path.join(Path.relative(tsconfigBackDir, backDir), "**/*.cts")
                    ]
                };

                await File.writeFile(tsconfigCtsPath, JSON.stringify(tsconfigCts, null, 2));

                tsconfigRoot.references!.push({ "path": Path.relative(backDir, tsconfigCtsPath) });
            }

            await File.writeFile(tsconfigRootPath, JSON.stringify(tsconfigRoot, null, 2));
        }

        if (config.flex !== undefined) {
            const _name = "flex";
            const flexDir = Path.join(baseDir, `${_name}`);
            const flexBuildDir = Path.join(buildDir, `${_name}`);
            const flexTypeDir = Path.join(typeDir, `${_name}`);

            const tsconfigFlexDir = Path.join(tsconfigDir, `${_name}`);

            const tsconfigRootPath = Path.join(flexDir, "tsconfig.json");
            const tsconfigFlexPath = Path.join(tsconfigFlexDir, `tsconfig.${_name}.json`);
            const tsconfigASLPath = Path.join(tsconfigFlexDir, "tsconfig.asl.json");

            // Add flex to tsconfig
            if (!tsconfig.references!.some(ref => Path.resolve(baseDir, ref.path) === flexDir)) {
                tsconfig.references!.push({ path: Path.join(Path.relative(baseDir, flexDir), "tsconfig.json") });
            }

            // Make the directory
            await File.mkdir(flexDir, { recursive: true });

            // Make config folder
            await File.mkdir(tsconfigFlexDir, { recursive: true });

            // main tsconfig
            const tsconfigRoot: TsConfig = {
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(Path.relative(flexDir, buildDir), ".tsbuildinfo")
                },
                references: [
                    { "path": Path.relative(flexDir, tsconfigASLPath) }
                ]
            };

            // Flex tsconfig
            const tsconfigFlex: TsConfig = {
                extends: Path.relative(tsconfigFlexDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022"
                    ],
                    types: [
                        Path.relative(tsconfigFlexDir, Path.join(this.typeDir, "node"))
                    ],
                    rootDir: Path.relative(tsconfigFlexDir, flexDir),
                    outDir: Path.relative(tsconfigFlexDir, flexBuildDir),
                    declarationDir: Path.relative(tsconfigFlexDir, flexTypeDir),
                    paths: {
                        "*": [
                            Path.join(Path.relative(tsconfigFlexDir, flexDir), "*")
                        ]
                    }
                },
                references: []
            };

            // Add dependency paths
            for (const dependency of dependencies) {
                tsconfigFlex.compilerOptions!.paths![`${dependency.name}/*`] = [Path.relative(tsconfigFlexDir, Path.join(dependency.path, "@types", _name, "*"))];
                tsconfigFlex.references!.push({ path: Path.relative(tsconfigFlexDir, Path.join(dependency.path, _name, "tsconfig.json")) });
            }

            await File.writeFile(tsconfigFlexPath, JSON.stringify(tsconfigFlex, null, 2));

            // ASL tsconfig
            const tsconfigASL: TsConfig = {
                extends: `.${Path.sep}${Path.relative(tsconfigFlexDir, tsconfigFlexPath)}`,
                compilerOptions: {
                    module: ModuleKind[ModuleKind.ES2022] as any,
                    tsBuildInfoFile: Path.relative(tsconfigFlexDir, Path.join(flexBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(Path.relative(tsconfigFlexDir, flexDir), "**/*.ts")
                ]
            };

            await File.writeFile(tsconfigASLPath, JSON.stringify(tsconfigASL, null, 2));

            await File.writeFile(tsconfigRootPath, JSON.stringify(tsconfigRoot, null, 2));
        }

        if (config.front !== undefined) {
            const _name = "front";
            const frontDir = Path.join(baseDir, `${_name}`);
            const frontBuildDir = Path.join(buildDir, `${_name}`);
            const frontTypeDir = Path.join(typeDir, `${_name}`);

            const tsconfigFrontDir = Path.join(tsconfigDir, `${_name}`);

            const tsconfigRootPath = Path.join(frontDir, "tsconfig.json");
            const tsconfigFrontPath = Path.join(tsconfigFrontDir, `tsconfig.${_name}.json`);
            const tsconfigASLPath = Path.join(tsconfigFrontDir, "tsconfig.asl.json");
            const tsconfigMtsPath = Path.join(tsconfigFrontDir, "tsconfig.mjs.json");

            // Add front to tsconfig
            if (!tsconfig.references!.some(ref => Path.resolve(baseDir, ref.path) === frontDir)) {
                tsconfig.references!.push({ path: Path.join(Path.relative(baseDir, frontDir), "tsconfig.json") });
            }

            // Make the directory
            await File.mkdir(frontDir, { recursive: true });

            // Make config folder
            await File.mkdir(tsconfigFrontDir, { recursive: true });

            // main tsconfig
            const tsconfigRoot: TsConfig = {
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: Path.join(Path.relative(frontDir, buildDir), ".tsbuildinfo")
                },
                references: [
                    { "path": Path.relative(frontDir, tsconfigASLPath) }
                ]
            };

            // Front tsconfig
            const tsconfigFront: TsConfig = {
                extends: Path.relative(tsconfigFrontDir, tsconfigBasePath),
                compilerOptions: {
                    composite: true,
                    lib: [
                        "ES2022"
                    ],
                    types: [
                        Path.relative(tsconfigFrontDir, Path.join(this.typeDir, "node"))
                    ],
                    rootDir: Path.relative(tsconfigFrontDir, frontDir),
                    outDir: Path.relative(tsconfigFrontDir, frontBuildDir),
                    declarationDir: Path.relative(tsconfigFrontDir, frontTypeDir),
                    paths: {
                        "*": [
                            Path.join(Path.relative(tsconfigFrontDir, frontDir), "*")
                        ]
                    }
                },
                references: []
            };

            // Add dependency paths
            for (const dependency of dependencies) {
                tsconfigFront.compilerOptions!.paths![`${dependency.name}/*`] = [
                    Path.relative(tsconfigFrontDir, Path.join(dependency.path, "@types", _name, "*")),
                    Path.relative(tsconfigFrontDir, Path.join(dependency.path, "@types", "flex", "*"))
                ];
                tsconfigFront.references!.push({ path: Path.relative(tsconfigFrontDir, Path.join(dependency.path, _name, "tsconfig.json")) });
                tsconfigFront.references!.push({ path: Path.relative(tsconfigFrontDir, Path.join(dependency.path, "flex", "tsconfig.json")) });
            }

            await File.writeFile(tsconfigFrontPath, JSON.stringify(tsconfigFront, null, 2));

            // ASL tsconfig
            const tsconfigASL: TsConfig = {
                extends: `.${Path.sep}${Path.relative(tsconfigFrontDir, tsconfigFrontPath)}`,
                compilerOptions: {
                    module: ModuleKind[ModuleKind.ES2022] as any,
                    tsBuildInfoFile: Path.relative(tsconfigFrontDir, Path.join(frontBuildDir, ".asl.tsbuildinfo")),
                },
                include: [
                    Path.join(Path.relative(tsconfigFrontDir, frontDir), "**/*.ts")
                ]
            };

            await File.writeFile(tsconfigASLPath, JSON.stringify(tsconfigASL, null, 2));

            if (config.front.allowMts) {
                // MTS tsconfig
                const tsconfigMts: TsConfig = {
                    extends: `.${Path.sep}${Path.relative(tsconfigFrontDir, tsconfigFrontPath)}`,
                    compilerOptions: {
                        module: ModuleKind[ModuleKind.ES2022] as any,
                        tsBuildInfoFile: Path.relative(tsconfigFrontDir, Path.join(frontBuildDir, ".cts.tsbuildinfo")),
                    },
                    include: [
                        Path.join(Path.relative(tsconfigFrontDir, frontDir), "**/*.mts")
                    ]
                };

                await File.writeFile(tsconfigMtsPath, JSON.stringify(tsconfigMts, null, 2));

                tsconfigRoot.references!.push({ "path": Path.relative(frontDir, tsconfigMtsPath) });
            }

            await File.writeFile(tsconfigRootPath, JSON.stringify(tsconfigRoot, null, 2));
        }

        await File.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));
    }

    private async initialize(options?: PackageManagerOptions) {
        const configs = [];
        const rapidDirs: string[] = [];

        // Setup directories that make up the package registry
        for (const dir of this.directories) {
            const rapidPath = Path.join(dir, ".rapid/");
            rapidDirs.push(rapidPath);

            // Find tsconfig for the directory
            // Should be located in `.rapid/tsconfig.json`
            const tsconfigPath = Path.join(rapidPath, "tsconfig.json");
            const tsconfigStat = await pathStat(tsconfigPath);
            if (tsconfigStat === undefined || options?.refresh) {
                // tsconfig does not exist, create it
                await File.mkdir(rapidPath, { recursive: true });

                const jobs: Promise<void>[] = [];
                const references: Typescript.ProjectReference[] = [];

                // Iterate all directories with a depth of 2
                // Structure goes Package/Version
                for (const packageEntry of await File.readdir(dir, { withFileTypes: true })) {
                    if (!packageEntry.isDirectory()) continue;
                    for (const versionEntry of await File.readdir(Path.join(dir, packageEntry.name), { withFileTypes: true })) {
                        if (!versionEntry.isDirectory()) continue;

                        const packagePath = Path.join(versionEntry.parentPath, versionEntry.name);

                        // Parse the package
                        jobs.push(
                            this.parse(Path.join(packagePath, RAPID_CONFIG_NAME))
                                .then(() => {
                                    references.push({
                                        path: Path.relative(rapidPath, Path.join(packagePath, "tsconfig.json"))
                                    });
                                }).catch((e) => {
                                    console.log(e);
                                    // TODO(randomuserhi): Log parser errors
                                })
                        );
                    }
                }

                // Create tsconfig
                const config: TsConfig = {
                    files: [],
                    compilerOptions: {
                        composite: true,
                        tsBuildInfoFile: ".tsbuildinfo"
                    },
                    references
                };

                await Promise.all(jobs);

                await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));

            } else if (!tsconfigStat.isFile()) {
                console.warn(`'.rapid/tsconfig.json' exists but expected a file instead of a folder. Skipping...`);
                continue;
            }

            configs.push(tsconfigPath);
        }

        // Start chokidar to watch for new packages being created
        const watcher = Chokidar.watch(this.directories, {
            depth: 3,
            awaitWriteFinish: true,
            ignoreInitial: true,
        });
        watcher.on("all", async (event, path) => {
            path = Path.resolve(path);

            // Find which directory this path belongs to
            const dirIndex = this.directories.findIndex(dir => path.startsWith(Path.resolve(dir)));
            if (dirIndex < 0) return; // path outside roots (shouldn't happen)
            const dir = this.directories[dirIndex];
            const rapidDir = rapidDirs[dirIndex];

            const relativePath = Path.relative(dir, path);
            const depth = relativePath.split(Path.sep).filter(Boolean).length;

            const relativePathFromRapidDir = Path.relative(rapidDir, path);

            if (depth === 3) {
                // File within a package was changed

                const basename = Path.basename(path);

                switch (basename) {
                case RAPID_CONFIG_NAME: {
                    // If the file was a config file, generate package content etc...
                    const baseDir = Path.dirname(path);
                    const packageTsConfigPath = Path.join(baseDir, "tsconfig.json");

                    // Remove package from typescript pipeline temporarily
                    {
                        const tsconfigPath = Path.join(rapidDir, "tsconfig.json");
                        const config: TsConfig = JSON.parse(await File.readFile(tsconfigPath, "utf-8"));

                        if (config.references === undefined) {
                            config.references = [];
                        }

                        const refIndex = config.references.findIndex(ref => Path.resolve(rapidDir, ref.path) === packageTsConfigPath);
                        if (refIndex > -1) {
                            config.references.splice(refIndex, 1);
                        }

                        await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));
                    }

                    // Re-parse the config
                    await this.parse(path);

                    // Manage build tsconfig
                    const addEvent = event === "add" || event === "change";
                    const unlinkEvent = event === "unlink";
                    if (addEvent || unlinkEvent) {
                        const tsconfigPath = Path.join(rapidDir, "tsconfig.json");
                        const config: TsConfig = JSON.parse(await File.readFile(tsconfigPath, "utf-8"));

                        if (config.references === undefined) {
                            config.references = [];
                        }

                        if (addEvent && !config.references.some(ref => Path.resolve(rapidDir, ref.path) === packageTsConfigPath)) {
                            config.references.push({
                                path: Path.relative(rapidDir, packageTsConfigPath)
                            });
                        } else if (unlinkEvent) {
                            const refIndex = config.references.findIndex(ref => Path.resolve(rapidDir, ref.path) === packageTsConfigPath);
                            if (refIndex > -1) {
                                config.references.splice(refIndex, 1);
                            }
                        }

                        await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));
                    }
                } break;
                }
            } else if (event === "unlinkDir") {
                // Directory containing packages was deleted, remove all paths that begin with the path prefix from our build list

                const tsconfigPath = Path.join(rapidDir, "tsconfig.json");
                const config: TsConfig = JSON.parse(await File.readFile(tsconfigPath, "utf-8"));

                if (config.references === undefined) {
                    config.references = [];
                }

                config.references = config.references.filter(ref => !ref.path.startsWith(relativePathFromRapidDir));

                await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));
            }
        });

        // Start the typescript compiler

        this.host = Typescript.createSolutionBuilderWithWatchHost(
            Typescript.sys,
            Typescript.createSemanticDiagnosticsBuilderProgram,
            reportDiagnostic,
            reportSolutionStatusChanged,
            reportWatchStatusChanged
        );

        // Overwrite behaviour for babel transpilation of asl files
        const origWriteFile = this.host.writeFile;
        this.host.writeFile = async (fileName, data) => {
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
                origWriteFile?.(fileName, data);
            } break;
            }
        };

        this.builder = Typescript.createSolutionBuilderWithWatch(this.host, configs, {});

        this.builder.build();

        // Cleanup on program exit
        const cleanup = () => {
            watcher.close();
        };

        process.on("exit", () => {
            cleanup();
            process.exit(0);
        });

        process.on("SIGINT", () => {
            cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            cleanup();
            process.exit(0);
        });
    }
}