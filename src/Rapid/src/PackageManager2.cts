import File from "fs/promises"
import Path from "path"
import Ts from "typescript"

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
            const baseDir = Path.join(dir, pckg, version);
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
}

/**
 * Error that happens when package is not found
 */
class PackageErrorNotFound extends Error {
    constructor(pckg: string, version: string) {
        super(`Package '${pckg}/${version}' was not found.`);
        this.name = "PackageErrorNotFound";
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PackageErrorNotFound);
        }
    }
}

/**
 * Package config
 */
interface PackageConfig {
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
 * Manages packages within a registry.
 */
export class PackageManager {

    private readonly registry: PackageRegistry;

    private readonly typeDir: string;

    /**
     * 
     * @param registry Registry of packages
     * @param typeDir Directory of standard library types such as "@types/node"
     */
    constructor(registry: PackageRegistry, typeDir: string) {
        this.registry = registry;
        this.typeDir = typeDir;
    }

    /** Makes the package, initializing the required tsconfigs */
    public async make(pckg: string, version: string) {
        const pckgInfo = await this.registry.get(pckg, version);
        if (pckgInfo === undefined) throw new PackageErrorNotFound(pckg, version);

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
    }

    /** Adds a package to watch list - automatically makes the package and builds it on changes. */
    public async watch(pckg: string, version: string) {

    }

    /** Removes a package from the watch list */
    public async unwatch(pckg: string, version: string) {

    }

    /** Builds the given package */
    public async build(pckg: string, version: string) {

    }
}