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
export class PackageInfo {
    /** package name */
    name: string;

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

    /** Last modified time used for re-reading config info */
    private mtimeMs: number = 0;
    
    /** Package config information */
    private cachedConfig: PackageConfig;

    constructor(configPath: string, configStat?: FileSync.Stats) {
        this.configPath = configPath;
        this.baseDir = Path.dirname(configPath);
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
    
        if (configStat === undefined) {
            configStat = FileSync.statSync(configPath);
        }

        this.mtimeMs = configStat.mtimeMs;
        this.cachedConfig = JSON.parse(FileSync.readFileSync(configPath, "utf-8"));
    }

    public get config() {
        // TODO(randomuserhi)
        return this.cachedConfig;
    }
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
 */
export class PackageRegistry {
    private readonly directories: string[];
    
    private readonly cache = new Map<string, { info: PackageInfo, mtimeMs: number }>();

    constructor(directories: string[]) {
        this.directories = directories;
    }
}