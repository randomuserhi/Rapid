import FileSync from "fs";
import File from "fs/promises";
import Http from "http";
import OS from "os";
import Path from "path";
import type { MapLike } from "typescript";
import { ASLEnvironment, ASLModule, ASLModuleObject, ASLPath, registry } from "./ASL/ASLRuntime.cjs";
import { PackageBuilder, PackageInfo, PackageRegistry, PackageWatchBuilder } from "./PackageBuilder.cjs";

/** Probes the file system to determine if it is case sensitive or not */
function isFileSystemCaseSensitive() {
    const tmpDir = FileSync.mkdtempSync(Path.join(OS.tmpdir(), "case-test-"));
    const fileA = Path.join(tmpDir, "TestFile");
    const fileB = Path.join(tmpDir, "testfile");

    FileSync.writeFileSync(fileA, "x");

    const caseSensitive = !FileSync.existsSync(fileB);

    FileSync.rmSync(tmpDir, { recursive: true, force: true });
    return caseSensitive;
}

/** Flag for if file system is case sensitive or not */
const CASE_SENSITIVE_FS = isFileSystemCaseSensitive();

/** Helper that determines if a file exists or not */
const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

const CHAR_FORWARD_SLASH = 47; /* / */

/**
 * Normalizes a path for pattern matching
 * 
 * @param path 
 */
function normalizePathPattern(path: string) {
    if (path.length !== 0) {
        path = Path.normalize(path).replaceAll("\\", "/");
        if (path.codePointAt(path.length - 1) === CHAR_FORWARD_SLASH) path = path.slice(0, -1);
        if (path.codePointAt(0) !== CHAR_FORWARD_SLASH) path = "/" + path;
    } else {
        path = "/";
    }
    return path;
}

/**
 * Helper function that finds matching file prefixes
 * 
 * @param path The path to match
 * @param patterns Map of patterns to be matched
 * @returns Matched pattern and postfix path
 */
function filePrefixMatch(path: string, patterns: MapLike<string[]>): { pattern: string, postfix: string } | undefined {
    path = normalizePathPattern(path);

    let longestMatch = -1;
    let matchedPattern: { pattern: string, postfix: string } | undefined = undefined;
    for (const pattern in patterns) {
        let prefix = normalizePathPattern(pattern);
        let postfix = "";

        let isMatch = false;
        if (prefix === "/") {
            isMatch = path === "/";
        } else if (prefix === "/*") {
            prefix = "/";
            isMatch = path !== "/";
            postfix = path;
        } else {
            if (prefix.endsWith("/*")) {
                prefix = prefix.slice(0, -1);
                isMatch = path.startsWith(prefix);
                postfix = path.slice(prefix.length);
            } else {
                isMatch = prefix === path;
            }
        }

        let length = 0;
        let isBlank = false;
        for (let i = 0; i < prefix.length; ++i) {
            const code = prefix.charCodeAt(i);

            if (code === CHAR_FORWARD_SLASH) {
                isBlank = true;
            } else if (isBlank) {
                ++length;
                isBlank = false;
            }
        }

        if (isMatch && length > longestMatch) {
            longestMatch = length;
            matchedPattern = { pattern, postfix };
        }
    }

    return matchedPattern;
}

/**  */
type RestMethod = "GET" | "POST";

/**  */
interface Route {
    path: string;
    method: RestMethod;
    handler: (req: Http.IncomingMessage, res: Http.ServerResponse) => void;
}

/**  */
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.svg': 'application/image/svg+xml'
} as const;

/** */
class RapidLib {
    /** Package */
    private readonly app: RapidApp;

    private cache = new Map<string, ASLModuleObject>();

    constructor(app: RapidApp) {
        this.app = app;
    }

    public resolve(path: string): ASLModuleObject {
        // strip ".js" and ".cjs" extension from path
        if (!ASLPath.endsWithSeparator(path)) {
            const extLoc = ASLPath.findExtname(path);
            if (extLoc !== undefined) {
                const ext = path.slice(extLoc.start, extLoc.end);
                switch (ext) {
                case ".cjs":
                case ".js": path = path.slice(0, extLoc.start); break;
                }
            }
        }

        let obj = this.cache.get(path);
        if (obj === undefined) {
            if (path === "rapid") {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                obj = require("./RapidLib/rapid.cjs").link(this.app);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                obj = require(`.${Path.sep}${Path.join("RapidLib/lib", `${Path.relative("rapid", path)}.cjs`)}`).link(this.app);
            }
        }

        if (obj === undefined) throw new Error(`Could not find: ${path}`);
        return obj;
    }
}

/** TODO(randomuserhi): Move into some http helper script */
async function serveResource(path: string, res: Http.ServerResponse) {
    const extname: keyof typeof mimeTypes = Path.extname(path).toLowerCase() as any;
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    const content = await File.readFile(path);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
}

/** A single app instance that represents a package */
export class RapidApp {
    /** The runtime this app is part of */
    private readonly runtime: RapidRuntime;

    /** Package */
    public pckgInfo: PackageInfo;

    /** ASL environment of the app */
    private readonly environment: ASLEnvironment;

    /** Routes that are used to resolve certain URL paths */
    public readonly routes = new Map<RestMethod, Map<string, Route>>();

    /** RapidLib object */
    private rapidLib: RapidLib;

    /** List of static paths to check */
    private staticFrontPaths: string[];

    constructor(runtime: RapidRuntime, pckgInfo: PackageInfo) {
        this.runtime = runtime;
        this.pckgInfo = pckgInfo;

        this.staticFrontPaths = [
            this.pckgInfo.frontBuildDir,
            this.pckgInfo.frontDir,
            this.pckgInfo.flexBuildDir,
            this.pckgInfo.flexDir
        ];

        // Create rapid lib object
        this.rapidLib = new RapidLib(this);

        // Initialize ASL environment
        this.environment = new ASLEnvironment();
        this.environment.importHook = this.aslImportHook.bind(this);
    }

    /** Import hook to resolve ASL environment paths */
    private async aslImportHook(module: ASLModule, path: string): Promise<string | ASLModuleObject> {
        path = ASLPath.fixASLExt(Path.normalize(path));

        const {
            baseDir,
            buildDir,
            backDir,
            backBuildDir,
            flexBuildDir,
            flexDir
        } = this.pckgInfo;

        if (path.startsWith(".")) {
            // Handle relative import

            // Construct the full path given the module path
            const fullPath = Path.resolve(Path.join(module.dir, path));

            // If it exists, return the path
            if (await fileExists(fullPath)) return fullPath;

            let resolvedPath: string;

            // Otherwise, resolve the path by checking build / non-build directory paths
            // depending on which we started in
            const inBuildDir = fullPath.startsWith(buildDir);
            if (inBuildDir) {
                // If we are in build directory check non build directory
                const relPath = Path.relative(buildDir, fullPath);
                resolvedPath = Path.join(baseDir, relPath);
                if (await fileExists(resolvedPath)) return resolvedPath;
            } else {
                // If we are in non build directory check build directory
                const relPath = Path.relative(baseDir, fullPath);
                resolvedPath = Path.join(buildDir, relPath);
                if (await fileExists(resolvedPath)) return resolvedPath;
            }

            // If we still can't find it, check flex directories
            const inFlexDirectory = inBuildDir ? fullPath.startsWith(flexBuildDir) : fullPath.startsWith(flexDir);
            if (inFlexDirectory) {
                const relPath = inBuildDir ? Path.relative(backBuildDir, fullPath) : Path.relative(backDir, fullPath);

                // Check flex build path
                resolvedPath = Path.join(flexBuildDir, relPath);
                if (await fileExists(resolvedPath)) return resolvedPath;

                // Check flex path
                resolvedPath = Path.join(flexDir, relPath);
                if (await fileExists(resolvedPath)) return resolvedPath;
            }
        } else if (Path.extname(path) === "") {
            // For non-relative imports with no extension, just do a basic require
            // This is for standard library node modules like "path" or "file" etc...

            // Since module resolution is typically handled by unix paths, convert backslash to unix style slashes
            path = path.replace("\\", "/");

            // Special case for rapidlib:
            if (ASLPath.pckgName(path) === "rapid") {
                return this.rapidLib.resolve(path);
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require(path);
        } else {
            // Resolve absolute paths

            // Check package path (if it is a dependency import)
            const pckgName = ASLPath.pckgName(path);

            // Special case for rapidlib:
            if (pckgName === "rapid") {
                return this.rapidLib.resolve(path);
            }

            const pckgInfo = await this.runtime.packageRegistry.findPckg(pckgName);
            if (pckgInfo !== undefined) {
                const {
                    backDir,
                    backBuildDir,
                    flexDir,
                    flexBuildDir
                } = pckgInfo;
                
                // Trim the package name from the path
                path = Path.relative(pckgName, path);
                
                if (path !== "") {
                    // Check if it is in build folder first
                    let resolvedPath = Path.join(backBuildDir, path);
                    if (await fileExists(resolvedPath)) return resolvedPath;
                    
                    // Otherwise check base folder
                    resolvedPath = Path.join(backDir, path);
                    if (await fileExists(resolvedPath)) return resolvedPath;
                    
                    // Otherwise check flex build folder
                    resolvedPath = Path.join(flexBuildDir, path);
                    if (await fileExists(resolvedPath)) return resolvedPath;
                    
                    // Otherwise check flex folder
                    resolvedPath = Path.join(flexDir, path);
                    if (await fileExists(resolvedPath)) return resolvedPath;
                }

                const config = await pckgInfo.config(this.runtime.isWatching(this.pckgInfo));

                // Otherwise check package paths
                if (config.back?.paths !== undefined) {
                    const paths = config.back.paths;
                    const match = filePrefixMatch(path, paths);
                    if (match !== undefined) {
                        for (const path of paths[match.pattern]) {
                            let resolvedPath: string;
                            if (Path.basename(path) === "*") {
                                resolvedPath = Path.join(baseDir, Path.dirname(path), match.postfix);
                            } else {
                                resolvedPath = Path.join(baseDir, path);
                            }
                            if (await fileExists(resolvedPath)) return resolvedPath;
                        }
                    }
                }
            }
        }

        throw new Error(`Could not find: ${path}`);
    }

    /** Loads and runs the package's entry point */
    public async loadEntry() {
        const config = await this.pckgInfo.config(this.runtime.isWatching(this.pckgInfo));
        let entryPoint = config.back?.entry;
        if (entryPoint !== undefined) {
            entryPoint = Path.join(this.pckgInfo.baseDir, ".build", "back", ASLPath.fixASLExt(entryPoint));
            await this.environment.fetch(entryPoint);
        }
    }

    /** Handle requests for the given App */
    public async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        let resourcePath: string | undefined = undefined;

        try {
            // Trigger any handlers
            const group = this.routes.get(req.method! as RestMethod);
            if (group !== undefined) {
                const route = group.get(req.url!);
                if (route !== undefined) {
                    route.handler(req, res);
                    return;
                }
            }
    
            // Locate package resource
            if (req.url !== "/") {
                // Look for resource through static path list
                for (const prefix of this.staticFrontPaths) {
                    resourcePath = Path.join(prefix, req.url!);

                    if (await fileExists(resourcePath)) {
                        await serveResource(resourcePath, res);
                        return;
                    }
                }
            }

            // See if the config has a match for it
            const config = await this.pckgInfo.config(this.runtime.isWatching(this.pckgInfo));
            if (config.front?.paths !== undefined) {
                const paths = config.front.paths;
                const match = filePrefixMatch(req.url!, paths);
                if (match !== undefined) {
                    for (const path of paths[match.pattern]) {
                        if (Path.basename(path) === "*") {
                            resourcePath = Path.join(this.pckgInfo.baseDir, Path.dirname(path), match.postfix);
                        } else {
                            resourcePath = Path.join(this.pckgInfo.baseDir, path);
                        }

                        if (await fileExists(resourcePath)) {
                            await serveResource(resourcePath, res);
                            return;
                        }
                    }
                }
            }

            // Otherwise return 404 not found
            res.statusCode = 404;
            res.end("Not Found");
        } catch (err) {
            res.statusCode = 500;
            res.end("Internal Package Error");
            console.error(err);
        }
    }
}

export class RapidRuntime {
    /** Stores currently running app instances */
    private instances = new Map<string, RapidApp>();

    /** Set of packages that are being watched */
    private readonly watchList = new Map<string, PackageInfo>();

    /** Registry of packages */
    public readonly packageRegistry: PackageRegistry;

    /** Watch builder for automatically building packages */
    public readonly packageWatchBuilder: PackageWatchBuilder;

    /** Builder for building packages without watcher */
    public readonly packageBuilder: PackageBuilder;

    /**
     * 
     * @param directories 
     * @param typeDir 
     */
    public constructor(directories: string[], typeDir: string) {
        this.packageRegistry = new PackageRegistry(directories);
        this.packageWatchBuilder = new PackageWatchBuilder(this.packageRegistry, typeDir);
        this.packageBuilder = new PackageBuilder(typeDir);

        this.packageWatchBuilder.onIncrementalBuild = (paths) => {
            registry.invalidate(paths);
        };
    }

    private async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        try {
            // TODO(randomuserhi): Implement redirect on basic case for "/"
            //                     User can specify what they want for the default app

            const pckgNameLocation = ASLPath.findPckgName(req.url!);
            if (pckgNameLocation === undefined) {
                res.statusCode = 404;
                res.end("Not valid URL");
                return;
            }
        
            let pckgName = decodeURI(req.url!.slice(pckgNameLocation.start, pckgNameLocation.end));
            const pckgUrl = req.url!.slice(pckgNameLocation.end);

            // Manage rapid standard library
            let rapidLibResource: string | undefined = undefined;

            // Special case for root of standard library
            if (pckgName === "rapid.mjs" && pckgUrl === "") {
                rapidLibResource = Path.join(__dirname, "RapidWebLib", "rapid.mjs");
            } else {
                if (pckgUrl === "") {
                    // Redirect "localhost:3000/pckg" links to "localhost:3000/pckg/" otherwise relative imports fail:
                    // <script src="./script.js"> on "localhost:3000/pckg" resolves to "localhost:3000/script.js"
                    // but on "localhost:3000/pckg/" it resolves to "localhost:3000/pckg/script.js" properly
                    res.writeHead(302, { Location: `${pckgName}/` });
                    res.end();
                    return;
                }
            
                // Handle standard library routes 
                if (pckgName === "rapid") {
                    if (pckgUrl === "/") {
                        // TODO(randomuserhi): Special case for `/rapid` URL which should go to
                        //                     an internal website or readme (not 404)
                        res.statusCode = 404;
                        res.end("Not Found");
                        return;
                    }

                    rapidLibResource = Path.join(__dirname, "RapidWebLib/lib", decodeURI(pckgUrl));
                }
            }
            // Serve standard library resource if resolved, otherwise continue to regular package logic
            if (rapidLibResource !== undefined) {
                if (await fileExists(rapidLibResource)) {
                    await serveResource(rapidLibResource, res);
                } else {
                    res.statusCode = 404;
                    res.end("Not Found");
                }
                return;
            }
    
            // if file system is not case sensitive, resolve package names as always lower-case
            if (!CASE_SENSITIVE_FS) pckgName = pckgName.toLowerCase();
    
            let instance = this.instances.get(pckgName);
            if (instance === undefined) {
                const pckgInfo = await this.packageRegistry.findPckg(pckgName);
                if (pckgInfo === undefined) {
                    res.statusCode = 404;
                    res.end("Not valid package");
                    return;
                }
    
                // Auto watch launched apps
                this.watch(pckgInfo.name);
    
                // Launch app instance
                instance = new RapidApp(this, pckgInfo);
                await instance.loadEntry();
    
                this.instances.set(pckgName, instance);
            }
    
            // Pass request onto the given package
            req.url = pckgUrl;
            instance.onRequest(req, res);
        } catch (err) {
            res.statusCode = 500;
            res.end("Internal Server Error");
            console.error(err);
            return;
        }
    }

    public isWatching(pckg: PackageInfo) {
        return this.watchList.has(pckg.configPath);
    }

    public watch(pckg: string) {
        const pckgInfo = this.packageRegistry.findPckgSync(pckg);
        if (pckgInfo === undefined) return;
        
        if (this.watchList.has(pckgInfo.configPath)) return;
    
        this.watchList.set(pckgInfo.configPath, pckgInfo);
        this.packageWatchBuilder.start([...this.watchList.values()]);
    }
    
    public unwatch(pckg: string) {
        const pckgInfo = this.packageRegistry.findPckgSync(pckg);
        if (pckgInfo === undefined) return;

        if (!this.watchList.has(pckgInfo.configPath)) return;

        this.watchList.delete(pckgInfo.configPath);
        this.packageWatchBuilder.start([...this.watchList.values()]);
    }
    
    public listen(port: number): Promise<void> {
        return new Promise((resolve) => {
            Http.createServer(this.onRequest.bind(this)).listen(port, resolve);
        });
    }
}