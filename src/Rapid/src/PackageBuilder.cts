import { transform } from "@babel/core";
import Chokidar, { FSWatcher } from "chokidar";
import FileSync from "fs";
import File from "fs/promises";
import Path from "path";
import Ts from "typescript";
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";
import { Result } from "./PromiseResult.cjs";

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

/** Helper method to get file information. Returns undefined if file does not exist. */
function fileStatSync(path: string) {
    try {
        const stats = FileSync.statSync(path);
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

/**
 * Route overrides for resolving types and paths
 * Often used for interop for node_modules packages
 */
interface PackageRoutes {
    types?: Ts.MapLike<string[]>;
    paths?: Ts.MapLike<string[]>;
}

/**
 * Package config
 */
export interface PackageConfig {
    /** Config for backend code */
    back?: {
        /** Entry point for backend scripts */
        entry?: string;
    } & PackageRoutes;

    /** Config for flex code */
    flex?: PackageRoutes;

    /** Config for frontend code */
    front?: PackageRoutes;

    /** List of dependencies */
    dependencies?: string[];
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

/**
 * Metadata regarding a given package
 */
export interface PackageInfo {
    /** package name */
    name: string;

    /** Package config information */
    config: PackageConfig;

    /** Package base directory */
    baseDir: string;

    /** Package build directory */
    buildDir: string;

    /** Package type directory */
    typeDir: string;

    /** Package flex directory */
    flexTypeDir: string;

    /** Package back directory */
    backTypeDir: string;

    /** Package front directory */
    frontTypeDir: string;

    /** Package flex directory */
    flexDir: string;

    /** Package back directory */
    backDir: string;

    /** Package front directory */
    frontDir: string;

    /** Package build flex directory */
    flexBuildDir: string;

    /** Package build back directory */
    backBuildDir: string;

    /** Package build front directory */
    frontBuildDir: string;

    /** Config path */
    configPath: string;

    /** Ts config directory */
    TsconfigDir: string;
}

const RAPID_CONFIG_DIRNAME = "rapid.config.json";

const RAPID_TSCONFIG_DIRNAME = ".tsconfig";
const RAPID_BUILD_DIRNAME = ".build";
const RAPID_TYPES_DIRNAME = "@types";
const RAPID_FLEX_DIRNAME = "flex";
const RAPID_BACK_DIRNAME = "back";
const RAPID_FRONT_DIRNAME = "front";

/**
 * Manages the directories that exist in a registry and abstracts them behind
 * a single interface.
 * 
 * TODO(randomuserhi): PackageInfo should contain the parsed config file. 
 *                     The registry should caches PackageInfo objects and returns the same one to prevent reading disk all the time.
 *                     When fetching from cache, it checks if the file has been changed since last read (check file last-updated timestamp).
 *                     If it has, refetch from disk and update cache.
 */
export class PackageRegistry {
    private readonly directories: string[];

    private readonly cache = new Map<string, { info: PackageInfo, mtimeMs: number }>();

    constructor(directories: string[]) {
        this.directories = directories;
    }

    /** Helper function that creates package info object */
    private async createInfo(pckg: string, baseDir: string, configPath: string, configStat: FileSync.Stats): Promise<PackageInfo> {
        // Check cache
        let cachedInfo = this.cache.get(configPath);
        if (cachedInfo === undefined || cachedInfo.mtimeMs < configStat.mtimeMs) {
            cachedInfo = {
                info: {
                    name: pckg,
                    config: JSON.parse(await File.readFile(configPath, "utf-8")),
                    baseDir,
                    buildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME),
                    typeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME),
                    flexTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_FLEX_DIRNAME),
                    backTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_BACK_DIRNAME),
                    frontTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_FRONT_DIRNAME),
                    flexDir: Path.join(baseDir, RAPID_FLEX_DIRNAME),
                    backDir: Path.join(baseDir, RAPID_BACK_DIRNAME),
                    frontDir: Path.join(baseDir, RAPID_FRONT_DIRNAME),
                    flexBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_FLEX_DIRNAME),
                    backBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_BACK_DIRNAME),
                    frontBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_FRONT_DIRNAME),
                    configPath,
                    TsconfigDir: Path.join(baseDir, RAPID_TSCONFIG_DIRNAME)
                },
                mtimeMs: configStat.mtimeMs
            };
            this.cache.set(configPath, cachedInfo);
        }
        return cachedInfo.info;
    }

    /** Helper function that creates package info object */
    private createInfoSync(pckg: string, baseDir: string, configPath: string, configStat: FileSync.Stats): PackageInfo {
        // Check cache
        let cachedInfo = this.cache.get(configPath);
        if (cachedInfo === undefined || cachedInfo.mtimeMs < configStat.mtimeMs) {
            cachedInfo = {
                info: {
                    name: pckg,
                    config: JSON.parse(FileSync.readFileSync(configPath, "utf-8")),
                    baseDir,
                    buildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME),
                    typeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME),
                    flexTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_FLEX_DIRNAME),
                    backTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_BACK_DIRNAME),
                    frontTypeDir: Path.join(baseDir, RAPID_TYPES_DIRNAME, RAPID_FRONT_DIRNAME),
                    flexDir: Path.join(baseDir, RAPID_FLEX_DIRNAME),
                    backDir: Path.join(baseDir, RAPID_BACK_DIRNAME),
                    frontDir: Path.join(baseDir, RAPID_FRONT_DIRNAME),
                    flexBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_FLEX_DIRNAME),
                    backBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_BACK_DIRNAME),
                    frontBuildDir: Path.join(baseDir, RAPID_BUILD_DIRNAME, RAPID_FRONT_DIRNAME),
                    configPath,
                    TsconfigDir: Path.join(baseDir, RAPID_TSCONFIG_DIRNAME)
                },
                mtimeMs: configStat.mtimeMs
            };
            this.cache.set(configPath, cachedInfo);
        }
        return cachedInfo.info;
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
            const configPath = Path.join(baseDir, RAPID_CONFIG_DIRNAME);
            const pckgInfo = await this.fromConfigPath(configPath);
            if (pckgInfo === undefined) continue;
            return pckgInfo;
        }

        return undefined;
    }

    /**
     * Resolves a package name to its actual location on disk.
     * If there is a conflict, prioritises the first occurence. 
     * Priority is order of directories, where firstmost is given highest priority.
     * 
     * @param pckg Package name
     * @returns Package info or undefined if the package is not found
     */
    public getSync(pckg: string): PackageInfo | undefined {
        for (const dir of this.directories) {
            const baseDir = Path.resolve(Path.join(dir, pckg));
            const configPath = Path.join(baseDir, RAPID_CONFIG_DIRNAME);
            const pckgInfo = this.fromConfigPathSync(configPath);
            if (pckgInfo === undefined) continue;
            return pckgInfo;
        }

        return undefined;
    }

    /**
     * Resolves a package from the path to its config.
     * 
     * @param path Path to a given package
     * @returns Packinge info or undefined if the package is not found
     */
    public async fromConfigPath(path: string): Promise<PackageInfo | undefined> {
        path = Path.resolve(path);

        const basename = Path.basename(path);
        if (basename !== RAPID_CONFIG_DIRNAME) return undefined;

        const baseDir = Path.dirname(path);

        const pckg = Path.basename(baseDir);

        const configPath = Path.join(baseDir, RAPID_CONFIG_DIRNAME);
        const configStat = await fileStat(configPath);

        if (configStat !== undefined && configStat.isFile()) {
            return await this.createInfo(pckg, baseDir, configPath, configStat);
        }

        return undefined;
    }

    /**
     * Resolves a package from the path to its config.
     * 
     * @param path Path to a given package
     * @returns Packinge info or undefined if the package is not found
     */
    public fromConfigPathSync(path: string): PackageInfo | undefined {
        path = Path.resolve(path);

        const basename = Path.basename(path);
        if (basename !== RAPID_CONFIG_DIRNAME) return undefined;

        const baseDir = Path.dirname(path);

        const pckg = Path.basename(baseDir);

        const configPath = Path.join(baseDir, RAPID_CONFIG_DIRNAME);
        const configStat = fileStatSync(configPath);

        if (configStat !== undefined && configStat.isFile()) {
            return this.createInfoSync(pckg, baseDir, configPath, configStat);
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
 * Initializes a given package, generating all necessary typescript files and folders required for building
 * 
 * @param registry Package registry for resolving dependencies
 * @param configPath Path to config file
 * @param typeDir Path to default types for packages
 */
async function initPackage(registry: PackageRegistry, info: PackageInfo, typeDir: string) {
    /**
     * Packages are made up of 3 repositories (repos):
     * - back => This is for backend code that runs on NodeJS
     * - front => This is for frontend code that runs on browser
     * - flex => This is for code that can run in both backend or frontend
     * 
     * A package must contain atleast one of these sub-repos.
     */

    // Get the package config
    const config = info.config;

    // Generate configs

    // Resolve dependency paths
    const dependencies: PackageInfo[] = [];
    if (config.dependencies !== undefined) {
        const jobs: Promise<void>[] = [];

        // TODO(randomuserhi): Make dependencies an array not a k,v pair
        for (const dependency of config.dependencies) {
            if (dependency === info.name) continue; // Skip dependency on self

            jobs.push(registry.get(dependency)
                .then(info => {
                    if (info !== undefined) {
                        dependencies.push(info);
                    }
                })
            );
        }

        await Promise.all(jobs);
    }

    // Generate the main config
    const tsconfigPath = Path.join(info.baseDir, "tsconfig.json");
    const tsconfig: TsConfig = {
        files: [],
        compilerOptions: {
            composite: true,
            tsBuildInfoFile: relPath(info.baseDir, Path.join(info.buildDir, ".tsbuildinfo"))
        },
        references: []
    };
    // Add sub-repos as reference for typescript to build them as required
    if (config.back !== undefined) {
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, "tsconfig.asl.json")) });
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, "tsconfig.cjs.json")) });
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, "tsconfig.mjs.json")) });
    }
    if (config.front !== undefined) {
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FRONT_DIRNAME, "tsconfig.asl.json")) });
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FRONT_DIRNAME, "tsconfig.mjs.json")) });
    }
    if (config.flex !== undefined) {
        tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FLEX_DIRNAME, "tsconfig.asl.json")) });
    }
    await File.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));

    // Generate config folder which holds all auto-generated configs for each sub-repo
    const tsconfigDir = info.TsconfigDir;
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

    // TODO(randomuserhi): Clean up below repo generation

    // Flex Repo
    {
        const createRepo = config.flex !== undefined;
        const repo = RAPID_FLEX_DIRNAME;
        const repoDir = info.flexDir;

        const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

        // Make the directory
        if (createRepo) await File.mkdir(repoDir, { recursive: true });
        // Make config folder
        await File.mkdir(repoTsconfigDir, { recursive: true });

        // Build directories
        const repoBuildDir = info.flexBuildDir;
        const repoTypeDir = info.flexTypeDir;

        // Build config paths
        const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
        const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
        const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");

        // Root tsconfig
        const repoTsconfigRoot: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: Path.join(relPath(repoDir, info.buildDir), `.${repo}.tsbuildinfo`)
            },
            references: [
                { "path": relPath(repoDir, repoTsconfigASLPath) }
            ]
        };
        if (createRepo) await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

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
        
        const paths = repoTsconfig.compilerOptions!.paths!;

        {
            paths[`${info.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(info.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = info.config;
            if (dependentConfig.flex !== undefined && dependentConfig.flex.types !== undefined) {
                const types = dependentConfig.flex.types;
                for (const k in types) {
                    const key = k === "/" ? info.name : `${info.name}${k}`;
                    if (!(key in paths)) paths[key] = [];
                    for (const path of types[k]) {
                        paths[key].push(relPath(repoTsconfigDir, Path.resolve(info.baseDir, path)));
                    }
                }
            }
        }

        // Add dependency paths
        const references: Ts.ProjectReference[] = [];
        for (const dependency of dependencies) {
            paths[`${dependency.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(dependency.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = dependency.config;
            if (dependentConfig.flex !== undefined && dependentConfig.flex.types !== undefined) {
                const types = dependentConfig.flex.types;
                for (const k in types) {
                    const key = k === "/" ? dependency.name : `${dependency.name}${k}`;
                    if (!(key in paths)) paths[key] = [];
                    for (const path of types[k]) {
                        paths[key].push(relPath(repoTsconfigDir, Path.resolve(dependency.baseDir, path)));
                    }
                }
            }

            // Push build reference
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.asl.json")) });
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

    // Back Repo
    {
        const createRepo = config.back !== undefined;
        const repo = RAPID_BACK_DIRNAME;
        const repoDir = info.backDir;

        const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

        // Make the directory
        if (createRepo) await File.mkdir(repoDir, { recursive: true });
        // Make config folder
        await File.mkdir(repoTsconfigDir, { recursive: true });

        // Build directories
        const repoBuildDir = info.backBuildDir;
        const repoTypeDir = info.backTypeDir;

        // Build config paths
        const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
        const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
        const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");
        const repoTsconfigCtsPath = Path.join(repoTsconfigDir, "tsconfig.cjs.json");
        const repoTsconfigMtsPath = Path.join(repoTsconfigDir, "tsconfig.mjs.json");

        // Root tsconfig
        const repoTsconfigRoot: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: Path.join(relPath(repoDir, info.buildDir), `.${repo}.tsbuildinfo`)
            },
            references: [
                { "path": relPath(repoDir, repoTsconfigASLPath) },
                { "path": relPath(repoDir, repoTsconfigCtsPath) },
                { "path": relPath(repoDir, repoTsconfigMtsPath) }
            ]
        };
        if (createRepo) await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

        // Repo config
        const repoTsconfig: TsConfig = {
            extends: relPath(repoTsconfigDir, tsconfigBasePath),
            compilerOptions: {
                composite: true,
                lib: [
                    "ES2022"
                ],
                types: [
                    relPath(repoTsconfigDir, Path.join(typeDir, "node"))
                ],
                rootDir: relPath(repoTsconfigDir, repoDir),
                outDir: relPath(repoTsconfigDir, repoBuildDir),
                declarationDir: relPath(repoTsconfigDir, repoTypeDir),
                paths: {
                    "*": [
                        Path.join(relPath(repoTsconfigDir, repoDir), "*")
                    ],
                    "rapid": [
                        relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_BACK_DIRNAME, "rapid.d.ts"))
                    ],
                    "rapid/*": [
                        relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_BACK_DIRNAME, "lib", "*"))
                    ]
                }
            }
        };

        const paths = repoTsconfig.compilerOptions!.paths!;
        
        {
            paths[`${info.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(info.backTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(info.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = info.config;
            if (dependentConfig.back !== undefined && dependentConfig.back.types !== undefined) {
                const types = dependentConfig.back.types;
                for (const k in types) {
                    const key = k === "/" ? info.name : `${info.name}${k}`;
                    if (!(key in paths)) paths[key] = [];
                    for (const path of types[k]) {
                        paths[key].push(relPath(repoTsconfigDir, Path.resolve(info.baseDir, path)));
                    }
                }
            }
        }
        
        // Add dependency paths
        const references: Ts.ProjectReference[] = [];
        for (const dependency of dependencies) {
            paths[`${dependency.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(dependency.backTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(dependency.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = dependency.config;
            if (dependentConfig.back !== undefined && dependentConfig.back.types !== undefined) {
                const types = dependentConfig.back.types;
                for (const k in types) {
                    const key = k === "/" ? dependency.name : `${dependency.name}${k}`;
                    if (!(key in paths)) paths[key] = [];
                    for (const path of types[k]) {
                        paths[key].push(relPath(repoTsconfigDir, Path.resolve(dependency.baseDir, path)));
                    }
                }
            }

            // Push build references
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.asl.json")) });
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.mjs.json")) });
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.cjs.json")) });
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, RAPID_FLEX_DIRNAME, "tsconfig.asl.json")) });
        }

        // Add flex folder as dependency
        repoTsconfig.compilerOptions!.paths!["*"].push(Path.join(relPath(repoTsconfigDir, info.flexDir), "*"));
        references.push({ path: relPath(repoTsconfigDir, Path.join(info.TsconfigDir, RAPID_FLEX_DIRNAME, "tsconfig.asl.json")) });

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
                Path.join(relPath(repoTsconfigDir, info.flexDir), "**/*.ts")
            ],
            references
        };
        await File.writeFile(repoTsconfigASLPath, JSON.stringify(repoTsconfigASL, null, 2));

        // CTS tsconfig
        const repoTsconfigCts: TsConfig = {
            extends: relPath(repoTsconfigDir, repoTsconfigPath),
            compilerOptions: {
                module: Ts.ModuleKind[Ts.ModuleKind.NodeNext] as any,
                moduleResolution: Ts.ModuleResolutionKind[Ts.ModuleResolutionKind.NodeNext] as any,
                tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".cjs.tsbuildinfo")),
            },
            include: [
                Path.join(relPath(repoTsconfigDir, repoDir), "**/*.cts"),
                Path.join(relPath(repoTsconfigDir, info.flexDir), "**/*.cts")
            ],
            references
        };

        await File.writeFile(repoTsconfigCtsPath, JSON.stringify(repoTsconfigCts, null, 2));

        // MTS tsconfig
        const repoTsconfigMts: TsConfig = {
            extends: relPath(repoTsconfigDir, repoTsconfigPath),
            compilerOptions: {
                module: Ts.ModuleKind[Ts.ModuleKind.NodeNext] as any,
                moduleResolution: Ts.ModuleResolutionKind[Ts.ModuleResolutionKind.NodeNext] as any,
                tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".mjs.tsbuildinfo")),
            },
            include: [
                Path.join(relPath(repoTsconfigDir, repoDir), "**/*.mts"),
                Path.join(relPath(repoTsconfigDir, info.flexDir), "**/*.cts")
            ],
            references
        };

        await File.writeFile(repoTsconfigMtsPath, JSON.stringify(repoTsconfigMts, null, 2));
    }

    // Front Repo
    {
        const createRepo = config.front !== undefined;
        const repo = RAPID_FRONT_DIRNAME;
        const repoDir = info.frontDir;

        const repoTsconfigDir = Path.join(tsconfigDir, `${repo}`);

        // Make the directory
        if (createRepo) await File.mkdir(repoDir, { recursive: true });
        // Make config folder
        await File.mkdir(repoTsconfigDir, { recursive: true });

        // Build directories
        const repoBuildDir = info.frontBuildDir;
        const repoTypeDir = info.frontTypeDir;

        // Build config paths
        const repoTsconfigPath = Path.join(repoTsconfigDir, `tsconfig.${repo}.json`);
        const repoTsconfigRootPath = Path.join(repoDir, "tsconfig.json");
        const repoTsconfigASLPath = Path.join(repoTsconfigDir, "tsconfig.asl.json");
        const repoTsconfigMtsPath = Path.join(repoTsconfigDir, "tsconfig.mjs.json");

        // Root tsconfig
        const repoTsconfigRoot: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: Path.join(relPath(repoDir, info.buildDir), `.${repo}.tsbuildinfo`)
            },
            references: [
                { "path": relPath(repoDir, repoTsconfigASLPath) },
                { "path": relPath(repoDir, repoTsconfigMtsPath) }
            ]
        };
        if (createRepo) await File.writeFile(repoTsconfigRootPath, JSON.stringify(repoTsconfigRoot, null, 2));

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
                declarationDir: relPath(repoTsconfigDir, repoTypeDir)
            }
        };

        // Browsers resolve paths differently, so we need to split path resolution
        // into ASL and MTS.
        //
        // On MTS (browsers), paths need to be URLs, hence they start with "/" prefix.
        // ASL does not require this.

        const aslPaths: Ts.MapLike<string[]> = {
            "*": [
                Path.join(relPath(repoTsconfigDir, repoDir), "*")
            ],
            "rapid": [
                relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_FRONT_DIRNAME, "rapid.d.ts"))
            ],
            "rapid/*": [
                relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_FRONT_DIRNAME, "lib", "*"))
            ]
        };

        const mtsPaths: Ts.MapLike<string[]> = {
            "/rapid": [
                relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_FRONT_DIRNAME, "rapid.d.ts"))
            ],
            "/rapid/*": [
                relPath(repoTsconfigDir, Path.join(typeDir, "rapid", RAPID_FRONT_DIRNAME, "lib", "*"))
            ]
        };

        {
            aslPaths[`${info.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(info.frontTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(info.flexTypeDir, "*"))
            ];
            mtsPaths[`/${info.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(info.frontTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(info.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = info.config;
            if (dependentConfig.front !== undefined && dependentConfig.front.types !== undefined) {
                const types = dependentConfig.front.types;
                for (const k in types) {
                    {
                        const key = k === "/" ? info.name : `${info.name}${k}`;

                        if (!(key in aslPaths)) aslPaths[key] = [];
                        for (const path of types[k]) {
                            aslPaths[key].push(relPath(repoTsconfigDir, Path.resolve(info.baseDir, path)));
                        }
                    }

                    {
                        const key = k === "/" ? `/${info.name}` : `/${info.name}${k}`;

                        if (!(key in mtsPaths)) mtsPaths[key] = [];
                        for (const path of types[k]) {
                            mtsPaths[key].push(relPath(repoTsconfigDir, Path.resolve(info.baseDir, path)));
                        }
                    }
                }
            }
        }

        // Add dependency paths
        const references: Ts.ProjectReference[] = [];
        for (const dependency of dependencies) {
            aslPaths[`${dependency.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(dependency.frontTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(dependency.flexTypeDir, "*"))
            ];
            mtsPaths[`/${dependency.name}/*`] = [
                relPath(repoTsconfigDir, Path.join(dependency.frontTypeDir, "*")),
                relPath(repoTsconfigDir, Path.join(dependency.flexTypeDir, "*"))
            ];

            // Parse and manage dependency type paths
            const dependentConfig = dependency.config;
            if (dependentConfig.front !== undefined && dependentConfig.front.types !== undefined) {
                const types = dependentConfig.front.types;
                for (const k in types) {
                    {
                        const key = k === "/" ? dependency.name : `${dependency.name}${k}`;

                        if (!(key in aslPaths)) aslPaths[key] = [];
                        for (const path of types[k]) {
                            aslPaths[key].push(relPath(repoTsconfigDir, Path.resolve(dependency.baseDir, path)));
                        }
                    }

                    {
                        const key = k === "/" ? `/${dependency.name}` : `/${dependency.name}${k}`;

                        if (!(key in mtsPaths)) mtsPaths[key] = [];
                        for (const path of types[k]) {
                            mtsPaths[key].push(relPath(repoTsconfigDir, Path.resolve(dependency.baseDir, path)));
                        }
                    }
                }
            }

            //

            // Push build references
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.asl.json")) });
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, repo, "tsconfig.mjs.json")) });
            references.push({ path: relPath(repoTsconfigDir, Path.join(dependency.TsconfigDir, RAPID_FLEX_DIRNAME, "tsconfig.asl.json")) });
        }

        // Add flex folder as dependency
        aslPaths["*"].push(Path.join(relPath(repoTsconfigDir, info.flexDir), "*"));
        references.push({ path: relPath(repoTsconfigDir, Path.join(info.TsconfigDir, RAPID_FLEX_DIRNAME, "tsconfig.asl.json")) });

        await File.writeFile(repoTsconfigPath, JSON.stringify(repoTsconfig, null, 2));

        // ASL tsconfig
        const repoTsconfigASL: TsConfig = {
            extends: relPath(repoTsconfigDir, repoTsconfigPath),
            compilerOptions: {
                module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".asl.tsbuildinfo")),
                paths: aslPaths
            },
            include: [
                Path.join(relPath(repoTsconfigDir, repoDir), "**/*.ts"),
                Path.join(relPath(repoTsconfigDir, info.flexDir), "**/*.ts")
            ],
            references
        };
        await File.writeFile(repoTsconfigASLPath, JSON.stringify(repoTsconfigASL, null, 2));

        // MTS tsconfig
        const repoTsconfigMts: TsConfig = {
            extends: relPath(repoTsconfigDir, repoTsconfigPath),
            compilerOptions: {
                module: Ts.ModuleKind[Ts.ModuleKind.ES2022] as any,
                tsBuildInfoFile: relPath(repoTsconfigDir, Path.join(repoBuildDir, ".mjs.tsbuildinfo")),
                paths: mtsPaths
            },
            include: [
                Path.join(relPath(repoTsconfigDir, repoDir), "**/*.mts"),
                Path.join(relPath(repoTsconfigDir, info.flexDir), "**/*.mts")
            ],
            references
        };

        await File.writeFile(repoTsconfigMtsPath, JSON.stringify(repoTsconfigMts, null, 2));
    }
}

/**
 * Watches a set of packages and auto-triggers typescript incremental builds
 */
export class PackageWatchBuilder {

    /** Typescript watch host */
    private readonly watchHost: Ts.SolutionBuilderWithWatchHost<Ts.SemanticDiagnosticsBuilderProgram> = undefined!;

    /** Typescript builder */
    private builder: Ts.SolutionBuilder<Ts.SemanticDiagnosticsBuilderProgram> | undefined = undefined;

    /** Stores the created file watchers by typescript so that we can close them */
    private readonly fileWatchers = new Set<Ts.FileWatcher>();

    /** Chokidar watcher for configs */
    private configWatcher: FSWatcher | undefined = undefined;

    /** Diagnostic callback */
    public reportDiagnostic: Ts.DiagnosticReporter | undefined;

    /** Diagnostic callback */
    public reportSolutionBuilderStatus: Ts.DiagnosticReporter | undefined;

    /** Babel Diagnostic callback */
    public reportBabelDiagnostic: ((ASLTranspilationResults: Result<any>[]) => void) | undefined;

    /** Callback triggered when all files are built, provides a list of ASL scripts that were transpiled for this build */
    public onIncrementalBuild: ((ASLFiles: string[]) => void) | undefined;

    /** Current list of transpilation results */
    private ASLTranspilationResults: Result<any>[] = [];

    /** Path to default package types */
    private readonly typeDir: string;

    /** List of packages currently being watched */
    private watchList: PackageInfo[] = [];

    /** Package registry for resolving dependencies */
    private readonly registry: PackageRegistry;

    // Watch Typescript build status to trigger onIncrementalBuild callback
    private reportWatchStatus(diagnostic: Ts.Diagnostic, newLine: string, options: Ts.CompilerOptions, errorCount?: number) {
        // Refer to https://github.com/microsoft/TypeScript/issues/32542

        // Clear results
        const ASLTranspilationResults = this.ASLTranspilationResults;
        this.ASLTranspilationResults = [];

        // Report babel diagnostics regardless of build error / success
        if (diagnostic.code === 6193 || diagnostic.code === 6194) {
            this.reportBabelDiagnostic?.(ASLTranspilationResults);
        }

        // Handle successful build step
        if (diagnostic.code === 6194) {
            if (errorCount === undefined || errorCount === 0) {
                // Collect successful ASL transpilations
                const paths: string[] = [];
                for (const result of ASLTranspilationResults) {
                    if (result.ok()) paths.push(result.item);
                }

                // Trigger callback on successfully ASL transpiled files
                this.onIncrementalBuild?.(paths);
            }
        }
    }

    constructor(registry: PackageRegistry, typeDir: string) {
        this.registry = registry;
        this.typeDir = typeDir;

        // Create a new typescript system which keeps track of file watchers
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

        // Create host
        this.watchHost = Ts.createSolutionBuilderWithWatchHost(
            sys,
            Ts.createSemanticDiagnosticsBuilderProgram,
            (...args: Parameters<Ts.DiagnosticReporter>) => this.reportDiagnostic?.(...args),
            (...args: Parameters<Ts.DiagnosticReporter>) => this.reportSolutionBuilderStatus?.(...args),
            this.reportWatchStatus.bind(this)
        );

        // Overwrite writeFile behaviour to transpile asl files
        const origWriteFile = this.watchHost.writeFile;
        this.watchHost.writeFile = (fileName, code, writeByteOrderMark) => {
            const extname = Path.extname(fileName);
            switch (extname) {
            // Only treat`.js` output files as ASL scripts
            case ".js": {
                // Perform transpilation
                const babelResult = transform(code, ASLBabelConfig);
                if (!babelResult || !babelResult.code) {
                    // Error in transpilation, skip and push error result
                    // TODO(randomuserhi): Better error message.
                    this.ASLTranspilationResults.push(new Result(undefined, new Error("Babel Failed")));
                    return;
                }

                // Push successful transpilation result
                this.ASLTranspilationResults.push(new Result(fileName));

                // Write file as normal, with transpiled code
                origWriteFile?.(fileName, babelResult.code, writeByteOrderMark);
            } break;

                // Treat other files as normal
            default: {
                origWriteFile?.(fileName, code, writeByteOrderMark);
            } break;
            }
        };

        // Cleanup watchers properly on program end

        const cleanup = () => {
            this.stop();
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

    /** 
     * Starts the watcher to auto-build the given packages 
     * 
     * @param packages List of packages to watch
     */
    public start(packages: PackageInfo[]) {
        this.watchList = packages;

        // Stop current builder if needed
        if (this.builder !== undefined) this.stop();
        if (this.watchList.length === 0) return;

        // Create a new builder and start it
        this.builder = Ts.createSolutionBuilderWithWatch(this.watchHost, this.watchList.map(p => p.baseDir), {});
        this.builder.build();

        // Watch for changes in config to retrigger rebuild
        this.configWatcher = Chokidar.watch(this.watchList.map(p => p.configPath), {
            ignoreInitial: true
        });
        this.configWatcher.on("change", async (configPath) => {
            this.stop(); // Stop builds temporarily while re-initializing package

            const info = await this.registry.fromConfigPath(configPath);
            if (info !== undefined) {
                try {
                    await initPackage(this.registry, info, this.typeDir);
                } catch (err) {
                    console.error(err);
                }
            }

            this.start(this.watchList); // Start builds again
        });
    }

    /** 
     * Stops the watcher
     */
    public stop() {
        // Stop the config watcher
        this.configWatcher?.close();
        this.configWatcher = undefined;

        // Stop all file watchers
        for (const watcher of this.fileWatchers) watcher.close();
        this.fileWatchers.clear();

        // unassign builder
        this.builder = undefined;
    }
}

export class PackageBuilder {
    private readonly host: Ts.SolutionBuilderHost<Ts.SemanticDiagnosticsBuilderProgram>;

    /** Diagnostic callback */
    public reportDiagnostic: Ts.DiagnosticReporter | undefined;

    /** Diagnostic callback */
    public reportSolutionBuilderStatus: Ts.DiagnosticReporter | undefined;

    /** Babel Diagnostic callback */
    public reportBabelDiagnostic: ((ASLTranspilationResults: Result<any>[]) => void) | undefined;

    /** Current list of transpilation results */
    private ASLTranspilationResults: Result<any>[] = [];

    /** Path to default package types */
    private readonly typeDir: string;

    constructor(typeDir: string) {
        this.typeDir = typeDir;

        this.host = Ts.createSolutionBuilderHost(
            Ts.sys,
            Ts.createSemanticDiagnosticsBuilderProgram,
            (...args: Parameters<Ts.DiagnosticReporter>) => this.reportDiagnostic?.(...args),
            (...args: Parameters<Ts.DiagnosticReporter>) => this.reportSolutionBuilderStatus?.(...args)
        );

        // Overwrite writeFile behaviour to transpile asl files
        const origWriteFile = this.host.writeFile;
        this.host.writeFile = (fileName, code, writeByteOrderMark) => {
            const extname = Path.extname(fileName);
            switch (extname) {
            // Only treat`.js` output files as ASL scripts
            case ".js": {
                // Perform transpilation
                const babelResult = transform(code, ASLBabelConfig);
                if (!babelResult || !babelResult.code) {
                    // Error in transpilation, skip
                    // TODO(randomuserhi): Better error message.
                    this.ASLTranspilationResults.push(new Result(undefined, new Error("Babel Failed")));
                    return;
                }

                // Write file as normal, with transpiled code
                origWriteFile?.(fileName, babelResult.code, writeByteOrderMark);
            } break;

                // Treat other files as normal
            default: {
                origWriteFile?.(fileName, code, writeByteOrderMark);
            } break;
            }
        };
    }

    /** Builds the given package */
    public async build(registry: PackageRegistry, pckgInfo: PackageInfo) {
        await initPackage(registry, pckgInfo, this.typeDir);

        const builder = Ts.createSolutionBuilder(this.host, [pckgInfo.baseDir], {});
        builder.build();
    }
}


/**
 * Manages packages within a registry
 */
export class PackageManager_DEPRECATED {
    private readonly registry: PackageRegistry;

    private readonly typeDir: string;

    public readonly watchBuilder: PackageWatchBuilder;
    public readonly builder: PackageBuilder;

    private watchList: PackageInfo[] = [];

    /**
     * 
     * @param registry Registry of packages
     * @param typeDir Directory of standard library types such as "@types/node"
     */
    constructor(registry: PackageRegistry, typeDir: string) {
        this.registry = registry;
        this.typeDir = typeDir;

        this.watchBuilder = new PackageWatchBuilder(registry, this.typeDir);
        this.builder = new PackageBuilder(this.typeDir);
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

        const index = this.watchList.findIndex((info) => info.baseDir === pckgInfo.baseDir);
        if (index < 0) {
            this.watchBuilder.stop();
            this.watchList.push(pckgInfo);
            this.watchBuilder.start(this.watchList);
        }
    }

    /** Removes a package from the watch list */
    public async unwatch(pckg: string) {
        const pckgInfo = await this.registry.get(pckg);
        if (pckgInfo === undefined) throw new PackageNotFoundError(pckg);

        const index = this.watchList.findIndex((info) => info.baseDir === pckgInfo.baseDir);
        if (index >= 0) {
            this.watchBuilder.stop();
            this.watchList.splice(index, 1);
            this.watchBuilder.start(this.watchList);
        }
    }

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

        this.watchBuilder.stop();
        this.builder.build(this.registry, pckgInfo);
        this.watchBuilder.start(this.watchList);
    }
}