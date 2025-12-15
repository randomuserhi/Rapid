import FileSync from "fs";
import File from "fs/promises";
import Http from "http";
import OS from "os";
import Path from "path";
import { ASLEnvironment, ASLModule, ASLModuleObject, registry } from "./ASL/ASLRuntime.cjs";
import { PackageBuilder, PackageConfig, PackageInfo, PackageRegistry, PackageWatchBuilder } from "./PackageBuilder.cjs";

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

const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

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

class RapidLib {
    /** Package */
    private readonly app: RapidApp;

    private cache = new Map<string, ASLModuleObject>();

    constructor(app: RapidApp) {
        this.app = app;
    }

    public resolve(path: string): ASLModuleObject {
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

    constructor(runtime: RapidRuntime, pckgInfo: PackageInfo) {
        this.runtime = runtime;
        this.pckgInfo = pckgInfo;

        // Create rapid lib object
        this.rapidLib = new RapidLib(this);

        // Initialize ASL environment
        this.environment = new ASLEnvironment();
        this.environment.importHook = this.aslImportHook.bind(this);
    }

    /** Import hook to resolve ASL environment paths */
    private async aslImportHook(module: ASLModule, path: string): Promise<string | ASLModuleObject> {
        path = Path.normalize(path);

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

            // Resolve rapidlib paths:
            if (path.startsWith("rapid")) {
                return this.rapidLib.resolve(path);
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require(path);
        } else {
            // Resolve absolute paths

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

            // Check package path (if it is a dependency import)
            const parts = path.split(Path.sep);
            const pckgName = parts[0];

            const pckgInfo = await this.runtime.packageRegistry.get(pckgName);
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

                // Otherwise check package paths
                if (pckgInfo.config.back?.paths !== undefined) {
                    const paths = pckgInfo.config.back.paths;

                    path.replaceAll("\\", "/");

                    let length = 0;
                    let match: { paths: string[], path: string } | undefined = undefined;
                    for (const k in paths) {
                        let pattern = k;
                        let isMatch = false;
                        let matchedPath = path;
                        if (pattern === "/") {
                            isMatch = path === "";
                        } else {
                            if (pattern.endsWith("/*")) {
                                pattern = pattern.slice(0, -1);
                            }

                            if (pattern.endsWith("/")) {
                                isMatch = path.startsWith(pattern);
                                matchedPath = path.replace(pattern, "");
                            } else {
                                isMatch = pattern === path;
                            }
                        }

                        const size = pattern.split("/").length - ((pattern.startsWith("/") || pattern.startsWith("./")) ? 1 : 0);
                        if (isMatch && size > length) {
                            length = size;
                            match = {
                                paths: paths[k],
                                path: matchedPath
                            };
                        }
                    }

                    if (match !== undefined) {
                        for (let p of match.paths) {
                            if (p.endsWith("/*")) {
                                p = p.slice(0, -1);
                            }

                            if (p.endsWith("/")) {
                                resolvedPath = Path.join(baseDir, p, match.path);
                            } else {
                                resolvedPath = Path.join(baseDir, p);
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
        const config: PackageConfig = JSON.parse(await File.readFile(this.pckgInfo.configPath, "utf-8"));
        let entryPoint = config.back?.entry;
        if (entryPoint !== undefined) {
            entryPoint = Path.join(this.pckgInfo.baseDir, ".build", "back", entryPoint);
            await this.environment.fetch(entryPoint);
        }
    }

    /** Handle requests for the given App */
    public async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        // Trigger any handlers
        const group = this.routes.get(req.method! as RestMethod);
        if (group !== undefined) {
            const route = group.get(req.url!);
            if (route !== undefined) {
                route.handler(req, res);
                return;
            }
        }

        // If no handler is found, try to find resource from "front" directory
        let resourcePath = Path.join(this.pckgInfo.frontBuildDir, req.url!);
        if (!await fileExists(resourcePath) || req.url! === "/") {
            // If its not in the build directory, check base directory
            resourcePath = Path.join(this.pckgInfo.frontDir, req.url!);
            if (!await fileExists(resourcePath) || req.url! === "/") {
                // Otherwise check flex directories
                resourcePath = Path.join(this.pckgInfo.flexBuildDir, req.url!);
                if (!await fileExists(resourcePath) || req.url! === "/") {
                    resourcePath = Path.join(this.pckgInfo.flexDir, req.url!);
                    // Finally check package path mappings
                    if ((!await fileExists(resourcePath) || req.url! === "/")) {
                        this.pckgInfo = (await this.runtime.packageRegistry.get(this.pckgInfo.name))!;

                        if (this.pckgInfo.config.front?.paths !== undefined) {
                            const paths = this.pckgInfo.config.front.paths;

                            const path = req.url!;

                            let length = 0;
                            let match: { paths: string[], path: string } | undefined = undefined;
                            for (const k in paths) {
                                let pattern = k;
                                let isMatch = false;
                                let matchedPath = path;
                                if (pattern === "/") {
                                    isMatch = path === "/";
                                } else {
                                    if (pattern.endsWith("/*")) {
                                        pattern = pattern.slice(0, -1);
                                    }

                                    if (pattern.endsWith("/")) {
                                        isMatch = path.startsWith(pattern);
                                        matchedPath = path.replace(pattern, "");
                                    } else {
                                        isMatch = pattern === path;
                                    }
                                }

                                const size = pattern.split("/").length - ((pattern.startsWith("/") || pattern.startsWith("./")) ? 1 : 0);
                                if (isMatch && size > length) {
                                    length = size;
                                    match = {
                                        paths: paths[k],
                                        path: matchedPath
                                    };
                                }
                            }

                            if (match !== undefined) {
                                for (let p of match.paths) {
                                    if (p.endsWith("/*")) {
                                        p = p.slice(0, -1);
                                    }

                                    if (p.endsWith("/")) {
                                        resourcePath = Path.join(this.pckgInfo.baseDir, p, match.path);
                                    } else {
                                        resourcePath = Path.join(this.pckgInfo.baseDir, p);
                                    }
                                    if (await fileExists(resourcePath)) break;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!await fileExists(resourcePath)) {
            // Otherwise return 404 not found
            res.statusCode = 404;
            res.end("Not Found");
            return;
        }

        // Serve resource

        const extname: keyof typeof mimeTypes = Path.extname(resourcePath).toLowerCase() as any;
        const contentType = mimeTypes[extname] || 'application/octet-stream';

        try {
            const content = await File.readFile(resourcePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        } catch (err) {
            res.statusCode = 500;
            res.end("Error 500");
            console.error(`${req.url} > ${resourcePath}: `, err);
        }
    }
}

/** Rapid Runtime */
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
        // TODO(randomuserhi): Implement redirect on basic case for "/"
        //                     User can specify what they want for the default app

        // Special case for fetching from Rapid standard library (front end)
        if (req.url!.toLowerCase().startsWith("/rapid")) {
            // Get url relative to rapid directory
            let url = new URL(req.url!.replace("/rapid", ""), "https://localhost/").pathname;

            // Resolve resource path
            let resourcePath;
            if (url === "/" || url === "/.mjs") {
                resourcePath = Path.join(__dirname, "RapidWebLib", "rapid.mjs");
            } else {
                if (Path.extname(url) === "") url += ".mjs"; // By default assume `.mjs` extension
                resourcePath = Path.join(__dirname, "RapidWebLib/lib", url);
            }

            // Serve resource

            const extname: keyof typeof mimeTypes = Path.extname(resourcePath).toLowerCase() as any;
            const contentType = mimeTypes[extname] || 'application/octet-stream';

            try {
                const content = await File.readFile(resourcePath);
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            } catch (err) {
                res.statusCode = 500;
                res.end("Error 500");
                console.error(`${req.url} > ${resourcePath}: `, err);
            }
            return;
        }

        // Obtain package from request
        const parts = req.url!.split("/");
        if (parts.length < 2) {
            res.statusCode = 404;
            res.end("Not valid URL");
            return;
        } else if (parts.length === 2) {
            // Redirect "localhost:3000/pckg" links to "localhost:3000/pckg/" otherwise relative imports fail:
            // <script src="./script.js"> on "localhost:3000/pckg" resolves to "localhost:3000/script.js"
            // but on "localhost:3000/pckg/" it resolves to "localhost:3000/pckg/script.js" properly
            res.writeHead(302, { Location: `${req.url!}/` });
            res.end();
            return;
        }

        const pckgPathPrefix = `/${parts[1]}`;

        let pckgName = decodeURI(parts[1]);

        // if file system is not case sensitive, resolve package names as always lower-case
        if (!CASE_SENSITIVE_FS) pckgName = pckgName.toLowerCase();

        if (pckgName === "") {
            res.statusCode = 404;
            res.end("Not valid URL");
            return;
        }

        let instance = this.instances.get(pckgName);
        if (instance === undefined) {
            const pckgInfo = await this.packageRegistry.get(pckgName);
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
        req.url = new URL(req.url!.replace(pckgPathPrefix, ""), "https://localhost/").pathname;
        instance.onRequest(req, res);
    }

    public watch(pckg: string) {
        if (this.watchList.has(pckg)) return;

        const info = this.packageRegistry.getSync(pckg);
        if (info === undefined) return;

        this.watchList.set(pckg, info);
        this.packageWatchBuilder.start([...this.watchList.values()]);
    }

    public unwatch(pckg: string) {
        if (!this.watchList.has(pckg)) return;
        this.watchList.delete(pckg);
        this.packageWatchBuilder.start([...this.watchList.values()]);
    }

    public listen(port: number): Promise<void> {
        return new Promise((resolve) => {
            Http.createServer(this.onRequest.bind(this)).listen(port, resolve);
        });
    }
}