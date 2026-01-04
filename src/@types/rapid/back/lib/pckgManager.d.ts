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
 * Package info
 */
export interface PackageInfo {
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

    /**
     * Gets the config associated with this package
     * 
     * @param keepUpToDate If true, will re-parse the config if it has since been modified
     * @returns The config object
     */
    configSync(keepUpToDate: boolean = false): PackageConfig;

    /**
     * Gets the config associated with this package
     * 
     * @param keepUpToDate If true, will re-parse the config if it has since been modified
     * @returns The config object
     */
    config(keepUpToDate: boolean = false): Promise<PackageConfig>;
}

/**
 * Find a package
 * @param pckgName Name of package
 */
export function findPckg(pckgName: string): PackageInfo | undefined;