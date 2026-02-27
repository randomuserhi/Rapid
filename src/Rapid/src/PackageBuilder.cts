import { transform } from "@babel/core";
import Chokidar, { FSWatcher } from "chokidar";
import FileSync from "fs";
import File from "fs/promises";
import Path from "path";
import Ts, { MapLike } from "typescript";
import { ASL_EXTENSION_JS, ASL_EXTENSION_JS_MAP, ASL_EXTENSION_TS, ASLPath } from "./ASL/ASLRuntime.cjs";
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";
import { onProcessExit } from "./ExitHandler.cjs";
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
interface PackagePathOverrides {
    types?: Ts.MapLike<string[]>;
    paths?: Ts.MapLike<string[]>;
    public?: string[];
}

/**
 * Package config
 */
export interface PackageConfig {
    /** Config for backend code */
    back?: {
        /** Entry point for backend scripts */
        entry?: string;
    } & PackagePathOverrides;

    /** Config for flex code */
    flex?: PackagePathOverrides;

    /** Config for frontend code */
    front?: PackagePathOverrides;

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

const RAPID_CONFIG_NAME = "rapid.config.json";

const RAPID_TSCONFIG_DIRNAME = ".tsconfig";
const RAPID_BUILD_DIRNAME = ".build";
const RAPID_TYPES_DIRNAME = "@types";
const RAPID_FLEX_DIRNAME = "flex";
const RAPID_BACK_DIRNAME = "back";
const RAPID_FRONT_DIRNAME = "front";

/**
 * Manages the directories that exist in a registry and abstracts them behind
 * a single interface.
 */
export class PackageRegistry {
    public readonly directories: string[];

    constructor(directories: string[]) {
        this.directories = directories;
    }

    /**
     * Resolves a package name to its actual location on disk.
     * If there is a conflict, prioritises the first occurence. 
     * Priority is order of directories, where firstmost is given highest priority.
     * 
     * @param pckg Package name
     * @returns Path to package config or undefined if the package is not found
     */
    public async findPckg(pckg: string): Promise<PackageInfo | undefined> {
        if (pckg === "") return undefined;

        for (const dir of this.directories) {
            const baseDir = Path.resolve(Path.join(dir, pckg));
            const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
            const configStat = await fileStat(configPath);
            if (configStat === undefined) continue;
            return PackageInfo.get(configPath);
        }

        return undefined;
    }

    /**
     * Resolves a package name to its actual location on disk.
     * If there is a conflict, prioritises the first occurence. 
     * Priority is order of directories, where firstmost is given highest priority.
     * 
     * @param pckg Package name
     * @returns Path to package config or undefined if the package is not found
     */
    public findPckgSync(pckg: string): PackageInfo | undefined {
        for (const dir of this.directories) {
            const baseDir = Path.resolve(Path.join(dir, pckg));
            const configPath = Path.join(baseDir, RAPID_CONFIG_NAME);
            const configStat = fileStatSync(configPath);
            if (configStat === undefined) continue;
            return PackageInfo.get(configPath);
        }

        return undefined;
    }
}

/** 
 * Config cache item used to minimize disk accesses when reading
 * package configs from PackageInfo
 */
interface ConfigCache {
    config: PackageConfig | undefined;
    mtimeMs: number;
}


/**
 * Metadata regarding a given package
 */
export class PackageInfo {
    /** package name */
    readonly name: string;

    /** Package base directory */
    readonly baseDir: string;

    /** Package build directory */
    readonly buildDir: string;

    /** Package type directory */
    readonly typeDir: string;

    /** Package flex directory */
    readonly flexTypeDir: string;

    /** Package back directory */
    readonly backTypeDir: string;

    /** Package front directory */
    readonly frontTypeDir: string;

    /** Package flex directory */
    readonly flexDir: string;

    /** Package back directory */
    readonly backDir: string;

    /** Package front directory */
    readonly frontDir: string;

    /** Package build flex directory */
    readonly flexBuildDir: string;

    /** Package build back directory */
    readonly backBuildDir: string;

    /** Package build front directory */
    readonly frontBuildDir: string;

    /** Config path */
    readonly configPath: string;

    /** Ts config directory */
    readonly TsconfigDir: string;

    private constructor(configPath: string) {
        this.configPath = Path.resolve(configPath);
        this.baseDir = Path.dirname(this.configPath);
        this.name = Path.basename(this.baseDir);

        this.buildDir = Path.join(this.baseDir, RAPID_BUILD_DIRNAME);
        this.typeDir = Path.join(this.baseDir, RAPID_TYPES_DIRNAME);
        this.flexTypeDir = Path.join(this.baseDir, RAPID_TYPES_DIRNAME, RAPID_FLEX_DIRNAME);
        this.backTypeDir = Path.join(this.baseDir, RAPID_TYPES_DIRNAME, RAPID_BACK_DIRNAME);
        this.frontTypeDir = Path.join(this.baseDir, RAPID_TYPES_DIRNAME, RAPID_FRONT_DIRNAME);
        this.flexDir = Path.join(this.baseDir, RAPID_FLEX_DIRNAME);
        this.backDir = Path.join(this.baseDir, RAPID_BACK_DIRNAME);
        this.frontDir = Path.join(this.baseDir, RAPID_FRONT_DIRNAME);
        this.flexBuildDir = Path.join(this.baseDir, RAPID_BUILD_DIRNAME, RAPID_FLEX_DIRNAME);
        this.backBuildDir = Path.join(this.baseDir, RAPID_BUILD_DIRNAME, RAPID_BACK_DIRNAME);
        this.frontBuildDir = Path.join(this.baseDir, RAPID_BUILD_DIRNAME, RAPID_FRONT_DIRNAME);
        this.TsconfigDir = Path.join(this.baseDir, RAPID_TSCONFIG_DIRNAME);
    }

    /** Cache of all loaded configs, used to minimize disk access */
    private static readonly configCache = new Map<string, ConfigCache>();

    /**
     * Gets the config associated with this package
     * 
     * @param keepUpToDate If true, will re-parse the config if it has since been modified
     * @returns The config object
     */
    public configSync(keepUpToDate: boolean = false): PackageConfig {
        let cache = PackageInfo.configCache.get(this.configPath);
        if (cache === undefined) {
            cache = {
                config: undefined,
                mtimeMs: -1
            };
            PackageInfo.configCache.set(this.configPath, cache);
        }

        if (keepUpToDate || cache.config === undefined) {
            const configStat = FileSync.statSync(this.configPath);
            if (configStat.mtimeMs > cache.mtimeMs) {
                cache.config = JSON.parse(FileSync.readFileSync(this.configPath, "utf-8"));
                cache.mtimeMs = configStat.mtimeMs;
            }
        }
        
        return cache.config!;
    }

    /**
     * Gets the config associated with this package
     * 
     * @param keepUpToDate If true, will re-parse the config if it has since been modified
     * @returns The config object
     */
    public async config(keepUpToDate: boolean = false): Promise<PackageConfig> {
        let cache = PackageInfo.configCache.get(this.configPath);
        if (cache === undefined) {
            cache = {
                config: undefined,
                mtimeMs: -1
            };
            PackageInfo.configCache.set(this.configPath, cache);
        }

        if (keepUpToDate || cache.config === undefined) {
            const configStat = await File.stat(this.configPath);
            if (configStat.mtimeMs > cache.mtimeMs) {
                cache.config = JSON.parse(await File.readFile(this.configPath, "utf-8"));
                cache.mtimeMs = configStat.mtimeMs;
            }
        }
        
        return cache.config!;
    }

    /**
     * Cache of all info objects.
     * This allows for a single object to be a source of truth and minimizes path operations. 
     */
    private static readonly cache = new Map<string, PackageInfo>();

    /** Create a package info object. */
    public static get(configPath: string): PackageInfo {
        configPath = Path.resolve(configPath);

        let cache = PackageInfo.cache.get(configPath);
        if (cache === undefined) {
            cache = new PackageInfo(configPath);
            PackageInfo.cache.set(configPath, cache);
        }

        return cache;
    }
}

/**
 * 
 * @param path 
 * @param config 
 */
async function writeTsConfig(path: string, config: TsConfig) {
    await File.mkdir(Path.dirname(path), { recursive: true });
    await File.writeFile(path, JSON.stringify(config, null, 2));
}

/**
 * 
 * @param paths 
 * @param key 
 * @param value 
 * @param browserStyle 
 */
function addTsPath(paths: Ts.MapLike<string[]>, key: string, value: string | string[], browserStyle: boolean) {
    if (browserStyle && !key.startsWith("/")) {
        key = "/" + key;
    }
    if (!Object.prototype.hasOwnProperty.call(paths, key)) {
        paths[key] = [];
    }
    if (typeof value === "string") {
        paths[key].push(value);
    } else {
        paths[key].push(...value);
    }
}

/**
 * TODO(randomuserhi): Document
 * @param options 
 */
async function generateInternalRepo(
    rootTsConfigPath: string,
    options: {
        pckg: PackageInfo,
        typeDir: string,
        
        /** Name of internal repo */
        name: "back" | "flex" | "front",

        /** names to inherit path overrides from */
        pathOverrideNames: ("back" | "flex" | "front")[],

        /** Package dependencies */
        additionalDependencies: PackageInfo[],
        
        /** What base libraries and types should the repo use */
        lib?: string[],
        types?: string[],

        /** Additional paths to include (part of standard library) */
        standardLibPaths?: MapLike<string>;

        /** Compilation variants, to support various file types (ASL, CJS, MJS) */
        variants: Ts.MapLike<{
            browserStyleImports: boolean,
            rapidLib: boolean,
            module: string,
            moduleResolution?: string,
            types?: string[],
            additionalIncludes: ("back" | "flex" | "front")[],
            /** Merges this variant with another repo. You can specify which variants are shared (both must support the given variant) */
            additionalReferences: { name: "back" | "flex" | "front", variants: string[] }[],
        }>
        
        createFolder: boolean,
    }) {
    const {
        name,
        pathOverrideNames,
        pckg,
        typeDir,
        createFolder,
        additionalDependencies,
        lib,
        types,
        standardLibPaths,
        variants
    } = options;

    const baseDir = Path.join(pckg.baseDir, name);
    const buildDir = Path.join(pckg.buildDir, name);
    const tsConfigDir = Path.join(pckg.TsconfigDir, name);

    const writeJobs: Promise<void>[] = [];
    

    // make type paths relative
    if (types !== undefined) {
        for (let i = 0; i < types.length; ++i) {
            types[i] = relPath(tsConfigDir, types[i]);
        }
    }

    // base build config for supported variants to extend
    const baseTsConfigPath = Path.join(tsConfigDir, `tsconfig.${name}.json`);
    {
        const config: TsConfig = {
            extends: relPath(tsConfigDir, rootTsConfigPath),
            compilerOptions: {
                composite: true,
                lib,
                types: types,
                rootDir: relPath(tsConfigDir, baseDir),
                outDir: relPath(tsConfigDir, buildDir),
                declarationDir: relPath(tsConfigDir, Path.join(pckg.baseDir, "@types", name)),
            }
        };
        writeJobs.push(writeTsConfig(baseTsConfigPath, config));
    }

    // add self to dependencies
    const dependencies = [pckg, ...additionalDependencies];

    // Build variant configs
    for (const variant in variants) {
        const {
            browserStyleImports,
            rapidLib,
            module,
            moduleResolution,
            additionalIncludes,
            additionalReferences,
            types: variantTypes
        } = variants[variant];

        // make variant type paths relative
        if (variantTypes !== undefined) {
            for (let i = 0; i < variantTypes.length; ++i) {
                variantTypes[i] = relPath(tsConfigDir, variantTypes[i]);
            }
        }

        // add self to includes
        const includes = [name, ...additionalIncludes];

        // Build reference list
        const references: Ts.ProjectReference[] = [];
        // Add self includes to reference list
        for (const include of additionalReferences) {
            for (const variant of include.variants) {
                references.push({ path: relPath(tsConfigDir, Path.join(pckg.TsconfigDir, include.name, `tsconfig${variant}.json`)) });
            }
        }
        // Add references from dependencies, unlike self, needs to include reference to main variant
        for (const dependency of additionalDependencies) {
            references.push({ path: relPath(tsConfigDir, Path.join(dependency.TsconfigDir, name, `tsconfig${variant}.json`)) });
            for (const include of additionalReferences) {
                for (const variant of include.variants) {
                    references.push({ path: relPath(tsConfigDir, Path.join(dependency.TsconfigDir, include.name, `tsconfig${variant}.json`)) });
                }
            }
        }

        // build paths
        const paths: Ts.MapLike<string[]> = {};

        // standard library paths
        if (rapidLib) {
            addTsPath(paths, "rapid", relPath(tsConfigDir, Path.join(typeDir, "rapid", name, "rapid.d.ts")), browserStyleImports);
            addTsPath(paths, "rapid/*", relPath(tsConfigDir, Path.join(typeDir, "rapid", name, "lib", "*")), browserStyleImports);
        }

        if (standardLibPaths) {
            for (const path in standardLibPaths) {
                addTsPath(paths, path, relPath(tsConfigDir, Path.join(typeDir, standardLibPaths[path])), browserStyleImports);
            }
        }

        // add dependency type paths
        for (const dependency of dependencies) {
            const dependentConfig = dependency.configSync();

            for (const include of includes) {
                const pathOverrides: PackagePathOverrides | undefined = (dependentConfig as any)[include];
                if (pathOverrides === undefined || pathOverrides.public === undefined) {
                    addTsPath(paths, `${dependency.name}/*`, relPath(tsConfigDir, Path.join(dependency.baseDir, include, "*")), browserStyleImports);
                } else {
                    for (const path of pathOverrides.public) {
                        // Note that path matching uses "/" instead of "\\"
                        addTsPath(paths, Path.join(dependency.name, path).replaceAll("\\", "/"), relPath(tsConfigDir, Path.join(dependency.baseDir, include, path)), browserStyleImports);
                    }
                }
            }

            for (const name of pathOverrideNames) {
                const pathOverrides: PackagePathOverrides | undefined = (dependentConfig as any)[name];
                if (pathOverrides !== undefined && pathOverrides.types !== undefined) {
                    const types = pathOverrides.types;
                    for (let key in types) {
                        const values = types[key].map(p => relPath(tsConfigDir, Path.resolve(dependency.baseDir, p)));
                        key = (key === "/" || key === "") ? dependency.name : `${dependency.name}${key.startsWith("/") ? "" : "/"}${key}`;
                        addTsPath(paths, key, values, browserStyleImports);
                    }
                }
            }
        }

        const combinedTypes = [];
        if (variantTypes !== undefined) combinedTypes.push(...variantTypes);
        if (types !== undefined) combinedTypes.push(...types);

        const config: TsConfig = {
            extends: relPath(tsConfigDir, baseTsConfigPath),
            compilerOptions: {
                module: module as any,
                moduleResolution: moduleResolution as any,
                types: combinedTypes,
                tsBuildInfoFile: relPath(tsConfigDir, Path.join(buildDir, `${variant}.tsbuildinfo`)),
                paths
            },
            include: [
                Path.join(relPath(tsConfigDir, Path.join(pckg.baseDir, name)), `**/*${variant}`)
            ],
            references
        };
        for (const include of additionalReferences) {
            const includeDir = Path.join(pckg.baseDir, include.name);
            for (const variant of include.variants) {
                config.include!.push(Path.join(relPath(tsConfigDir, includeDir), `**/*${variant}`));
            }
        }
        writeJobs.push(writeTsConfig(Path.join(tsConfigDir, `tsconfig${variant}.json`), config));
    }

    // Generate local tsconfig for vscode
    if (createFolder) {
        const config: TsConfig = {
            files: [],
            compilerOptions: {
                composite: true,
                tsBuildInfoFile: Path.join(relPath(baseDir, pckg.buildDir), `.${name}.tsbuildinfo`),
                noEmit: true
            },
            references: []
        };
        for (const variant in variants) {
            config.references!.push({ "path": relPath(baseDir, Path.join(tsConfigDir, `tsconfig${variant}.json`)) });
        }
        writeJobs.push(writeTsConfig(Path.join(baseDir, "tsconfig.json"), config));
    }

    await Promise.all(writeJobs);
}

/**
 * Map of package initialization jobs to prevent 2 of the same jobs running at the same time.
 * The key is the path to the config file being initialized. 
 * It should be the resolved full path.
 */
const initJobs = new Map<string, Promise<void>>();

interface InitPackageOptions {
    /** Initialize dependencies as well */
    initDependencies: boolean;

    /** Force initialization on self and all dependencies */
    force: boolean;

    /** Only forces initialization on self, not its dependencies */
    forceSelf: boolean;
}

/**
 * Initializes a given package, generating all necessary typescript files and folders required for building
 * 
 * @param registry Package registry for resolving dependencies
 * @param configPath Path to config file
 * @param typeDir Path to default types for packages
 */
async function initPackage(registry: PackageRegistry, info: PackageInfo, typeDir: string, options?: Partial<InitPackageOptions>) {
    // Create default options
    const parsedOptions: InitPackageOptions = {
        initDependencies: true,
        force: false,
        forceSelf: false
    };

    // Parse provided options
    if (options !== undefined) {
        for (const key in options) {
            const k = key as keyof InitPackageOptions;
            if (Object.prototype.hasOwnProperty.call(options, k)) {
                parsedOptions[k] = options[k] as never;
            }
        }
    }
    
    let job = initJobs.get(info.configPath);
    if (job === undefined) {
        // Get the package config
        const config = await info.config(true);

        if (!parsedOptions.forceSelf && !parsedOptions.force && await fileStat(info.TsconfigDir)) {
            // If we are not forcing the initialization, and the tsconfig folder already exists, 
            // skip as we assume the package has already been initialized
            return;
        }

        // Resolve dependency paths
        const dependencies: PackageInfo[] = [];
        if (config.dependencies !== undefined) {
            const jobs: Promise<void>[] = [];
    
            for (const dependency of config.dependencies) {
            // Skip dependency on self, this is implicit
                if (dependency === info.name) continue;
    
                jobs.push(registry.findPckg(dependency)
                    .then(info => {
                        if (info !== undefined) {
                            dependencies.push(info);
                        }
                    })
                );
            }
    
            await Promise.all(jobs);
        }

        if (parsedOptions.initDependencies) {
            // Initialize dependencies
            // TODO(randomuserhi): Discover circular dependencies and early exit them / throw an error
            const jobs: Promise<void>[] = [];
    
            for (const dependency of dependencies) {
                jobs.push(initPackage(registry, dependency, typeDir, { 
                    initDependencies: true,
                    force: parsedOptions.force,
                    forceSelf: false
                }));
            }
    
            await Promise.all(jobs);
        }

        job = (async () => {

            // Generate the main config
            const tsconfigPath = Path.join(info.baseDir, "tsconfig.json");
            const tsconfig: TsConfig = {
                files: [],
                compilerOptions: {
                    composite: true,
                    tsBuildInfoFile: relPath(info.baseDir, Path.join(info.buildDir, ".tsbuildinfo")),
                    noEmit: true
                },
                references: []
            };
            // Add sub-repos as reference for typescript to build them as required
            if (config.back !== undefined) {
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, `tsconfig${ASL_EXTENSION_TS}.json`)) });
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, "tsconfig.cts.json")) });
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_BACK_DIRNAME, "tsconfig.mts.json")) });
            }
            if (config.front !== undefined) {
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FRONT_DIRNAME, `tsconfig${ASL_EXTENSION_TS}.json`)) });
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FRONT_DIRNAME, "tsconfig.mts.json")) });
            }
            if (config.flex !== undefined) {
            tsconfig.references!.push({ path: relPath(info.baseDir, Path.join(info.TsconfigDir, RAPID_FLEX_DIRNAME, `tsconfig${ASL_EXTENSION_TS}.json`)) });
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
                        sourceMap: true,
                        inlineSources: true
                    }
                };
    
                await File.writeFile(tsconfigBasePath, JSON.stringify(tsconfigBase, null, 2));
            }

            // Generate repos
            await Promise.all([
                generateInternalRepo(tsconfigBasePath, {
                    name: "flex",
                    pathOverrideNames: ["flex"],
                    lib: ["ES2022"],
                    types: [
                        Path.join(typeDir, "flex")
                    ],
                    pckg: info,
                    typeDir,
                    createFolder: config.flex !== undefined,
                    additionalDependencies: dependencies,
                    variants: {
                        [ASL_EXTENSION_TS]: {
                            browserStyleImports: false,
                            rapidLib: false,
                            module: Ts.ModuleKind[Ts.ModuleKind.ES2022],
                            types: [
                                Path.join(typeDir, "asl"),
                            ],
                            additionalIncludes: [],
                            additionalReferences: []
                        }
                    }
                }),
                generateInternalRepo(tsconfigBasePath, {
                    name: "back",
                    pathOverrideNames: ["back", "flex"],
                    lib: ["ES2022", "DOM"],
                    types: [
                        Path.join(typeDir, "node"),
                    ],
                    standardLibPaths: {
                        "typescript": "typescript/typescript.d.ts",
                        "chokidar": "chokidar/index.d.ts",
                        "ws": "ws/index.d.ts",
                        "better-sqlite3": "better-sqlite3/index.d.ts"
                    },
                    pckg: info,
                    typeDir,
                    createFolder: config.back !== undefined,
                    additionalDependencies: dependencies,
                    variants: {
                        [ASL_EXTENSION_TS]: {
                            browserStyleImports: false,
                            rapidLib: true,
                            module: Ts.ModuleKind[Ts.ModuleKind.ES2022],
                            types: [
                                Path.join(typeDir, "asl"),
                            ],
                            additionalIncludes: [ "flex" ],
                            additionalReferences: [
                                { name: "back", variants: [ ".cts", ".mts" ] },
                                { name: "flex", variants: [ ASL_EXTENSION_TS ] }
                            ]
                        },
                        ".cts": {
                            browserStyleImports: false,
                            rapidLib: true,
                            module: Ts.ModuleKind[Ts.ModuleKind.NodeNext],
                            moduleResolution: Ts.ModuleResolutionKind[Ts.ModuleResolutionKind.NodeNext],
                            additionalReferences: [],
                            additionalIncludes: []
                        },
                        ".mts": {
                            browserStyleImports: false,
                            rapidLib: true,
                            module: Ts.ModuleKind[Ts.ModuleKind.NodeNext],
                            moduleResolution: Ts.ModuleResolutionKind[Ts.ModuleResolutionKind.NodeNext],
                            additionalReferences: [],
                            additionalIncludes: []
                        }
                    }
                }),
                generateInternalRepo(tsconfigBasePath, {
                    name: "front",
                    pathOverrideNames: ["front", "flex"],
                    pckg: info,
                    typeDir,
                    createFolder: config.front !== undefined,
                    additionalDependencies: dependencies,
                    variants: {
                        [ASL_EXTENSION_TS]: {
                            browserStyleImports: false,
                            rapidLib: true,
                            module: Ts.ModuleKind[Ts.ModuleKind.ES2022],
                            types: [
                                Path.join(typeDir, "asl"),
                            ],
                            additionalIncludes: [ "flex" ],
                            additionalReferences: [
                                { name: "front", variants: [ ".mts" ] },
                                { name: "flex", variants: [ ASL_EXTENSION_TS ] }
                            ]
                        },
                        ".mts": {
                            browserStyleImports: true,
                            rapidLib: true,
                            module: Ts.ModuleKind[Ts.ModuleKind.ES2022],
                            additionalReferences: [],
                            additionalIncludes: []
                        }
                    }
                })
            ]);

        })();

        initJobs.set(info.configPath, job);
    }

    await job;
}

/**
 * Cleans a given package, deleting its build folder.
 * Options can be provided to delete generated config files as well.
 * 
 * @param registry 
 * @param info 
 */
export async function cleanPackage(registry: PackageRegistry, info: PackageInfo, options?: { cleanConfigFiles: boolean }) {
    File.rm(info.buildDir, { recursive: true, force: true });

    if (options?.cleanConfigFiles) {
        File.rm(info.TsconfigDir, { recursive: true, force: true });
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

interface ASLBuilder {
    ASLTranspilationResults: Result<any>[];
    ASLObjects: Map<string, string>;
}

/**
 * Typescript writeFile override to manage ASL transpilation
 * 
 * @param this 
 * @param origWriteFile 
 * @param fileName 
 * @param code 
 * @param writeByteOrderMark 
 * @returns 
 */
function tsWriteFileOverride(this: ASLBuilder, origWriteFile: ((fileName: string, code: string, writeByteOrderMark?: boolean) => void) | undefined, fileName: string, code: string, writeByteOrderMark?: boolean) {
    const ext = ASLPath.extname(fileName);
    switch (ext) {
    // Only treat certain output files as ASL scripts
    case ASL_EXTENSION_JS_MAP:
    case ASL_EXTENSION_JS: {
        // Only write file once both sourcemap and code is generated
        // This is so that babel can remap the code as well
        let mapCode: string | undefined;
        let jsCode: string | undefined;
        let fileKey: string;

        if (ext === ASL_EXTENSION_JS_MAP) {
            fileKey = fileName.slice(0, -4);
            mapCode = code;
            jsCode = this.ASLObjects.get(fileKey);
        } else {
            fileKey = fileName;
            mapCode = this.ASLObjects.get(fileKey);
            jsCode = code;
        }

        if (mapCode === undefined) {
            this.ASLObjects.set(fileKey, jsCode!);
            return;
        } else if (jsCode === undefined) {
            this.ASLObjects.set(fileKey, mapCode!);
            return;
        }

        // Perform transpilation
        const babelResult = transform(jsCode, {
            ...ASLBabelConfig,
            sourceMaps: true,
            inputSourceMap: JSON.parse(mapCode)
        });
        if (!babelResult || !babelResult.code || !babelResult.map) {
            // Error in transpilation, skip
            // TODO(randomuserhi): Better error message.
            this.ASLTranspilationResults.push(new Result(undefined, new Error("Babel Failed")));
            return;
        }

        // Strip source mapping comment
        babelResult.code = babelResult.code.replace(/\/\/# sourceMappingURL=.*$/gm, "");

        // Write file as normal, with transpiled code
        origWriteFile?.(fileKey, babelResult.code, writeByteOrderMark);

        // Insert offset to mapping (All ASL scripts have a fixed offset due to how the script is generated via `Function` eval
        babelResult.map.mappings = ";;;" + babelResult.map.mappings;

        // Write transformed source map
        origWriteFile?.(`${fileKey}.map`, JSON.stringify(babelResult.map), writeByteOrderMark);

        // Push successful transpilation
        this.ASLTranspilationResults.push(new Result(fileKey));
    } break;

        // Treat other files as normal
    default: {
        origWriteFile?.(fileName, code, writeByteOrderMark);
    } break;
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

    /** Babel Diagnostic callback */
    public reportWatchStatus: Ts.WatchStatusReporter | undefined;

    /** Callback triggered when all files are built, provides a list of ASL scripts that were transpiled for this build */
    public onIncrementalBuild: ((ASLFiles: string[]) => void) | undefined;

    /** Current list of transpilation results */
    private ASLTranspilationResults: Result<any>[] = [];
    private ASLObjects = new Map<string, string>();

    /** Path to default package types */
    private readonly typeDir: string;

    /** List of packages currently being watched */
    private watchList: PackageInfo[] = [];

    /** Package registry for resolving dependencies */
    private readonly registry: PackageRegistry;

    // Watch Typescript build status to trigger onIncrementalBuild callback
    private internalReportWatchStatus(diagnostic: Ts.Diagnostic, newLine: string, options: Ts.CompilerOptions, errorCount?: number) {
        // Refer to https://github.com/microsoft/TypeScript/issues/32542

        // Clear results
        const ASLTranspilationResults = this.ASLTranspilationResults;
        this.ASLTranspilationResults = [];
        this.ASLObjects.clear();

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

        this.reportWatchStatus?.(diagnostic, newLine, options, errorCount);
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
            this.internalReportWatchStatus.bind(this)
        );

        // Overwrite writeFile behaviour to transpile asl files
        const origWriteFile = this.watchHost.writeFile;
        this.watchHost.writeFile = tsWriteFileOverride.bind(this as any, origWriteFile);

        // Cleanup watchers properly on program end
        onProcessExit(() => {
            this.stop();
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

            try {
                await initPackage(this.registry, PackageInfo.get(configPath), this.typeDir, { initDependencies: true, forceSelf: true });
            } catch (err) {
                console.error(err);
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
    private ASLObjects = new Map<string, string>();

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
        this.host.writeFile = tsWriteFileOverride.bind(this as any, origWriteFile);
    }

    /** Builds the given package */
    public async build(registry: PackageRegistry, pckgInfo: PackageInfo) {
        await initPackage(registry, pckgInfo, this.typeDir, { initDependencies: true, forceSelf: true });

        this.ASLTranspilationResults = [];
        this.ASLObjects.clear();

        const builder = Ts.createSolutionBuilder(this.host, [pckgInfo.baseDir], {});
        builder.build();
    }
}