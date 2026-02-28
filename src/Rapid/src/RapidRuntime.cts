import FileSync from "fs";
import File from "fs/promises";
import Http from "http";
import OS from "os";
import Path from "path";
import type Stream from "stream";
import { pipeline } from "stream/promises";
import Ts, { MapLike } from "typescript";
import { WebSocketServer } from "ws";
import { ASL_CONFIG, ASL_EXTENSION_JS, ASLEnvironment, ASLExecutionResult, ASLExports, ASLModuleId, ASLModuleInfo, ASLPath, registry } from "./ASL/ASLRuntime.cjs";
import { cleanPackage, PackageBuilder, PackageInfo, PackageRegistry, PackageWatchBuilder } from "./PackageBuilder.cjs";
import { Router } from "./Router.cjs";

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

/** Set ASL approapriately */
ASL_CONFIG.isCaseSensitive = CASE_SENSITIVE_FS;

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
        if (!Path.isAbsolute(path) && path.codePointAt(0) !== CHAR_FORWARD_SLASH) path = "/" + path;
    } else {
        path = "/";
    }
    return path;
}

/**
 * Helper function that finds matching file prefixes
 * 
 * @param path The path to match
 * @param patterns list of patterns to be matched
 * @returns Matched pattern and postfix path
 */
function filePrefixMatch(path: string, patterns: MapLike<any>): { pattern: string, postfix: string } | undefined {
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

/** TODO(randomuserhi): Move to some http utility module */
type RestMethod = "GET" | "POST";

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
    // Link hook function name
    private static readonly APP_LINK_HOOK = "__linkRapidApp";

    /** Package */
    private readonly app: RapidApp;

    private cache = new Map<string, ASLExports>();

    constructor(app: RapidApp) {
        this.app = app;
    }

    public resolve(path: string): ASLExports {
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
                obj = require("./RapidLib/rapid.cjs");
            } else {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                obj = require(`.${Path.sep}${Path.join("RapidLib/lib", `${Path.relative("rapid", path)}.cjs`)}`);
            }

            // Trigger app link hook so rapid standard library functions know what app they are associated with
            if (Object.prototype.hasOwnProperty.call(obj, RapidLib.APP_LINK_HOOK)) {
                obj = obj![RapidLib.APP_LINK_HOOK](this.app, obj);
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

    const stream = FileSync.createReadStream(path);
    
    res.writeHead(200, { 'Content-Type': contentType });
    await pipeline(stream, res);
}

/** 
 * A single app instance for a given package.
 * 
 * Manages its own standard library instance as well as requests.
 */
export class RapidApp {
    /** The runtime this app is part of */
    public readonly runtime: RapidRuntime;

    /** Package */
    public pckgInfo: PackageInfo;

    /** Routes that are used to resolve certain URL paths */
    public readonly httpRoutes = new Map<RestMethod, Router<[req: Http.IncomingMessage, res: Http.ServerResponse, url: URL, next: unknown]>>();

    /** Routes that are used for upgrading websocket connections */
    public readonly wsRoutes = new Router<[req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, next: unknown]>();

    /** RapidLib object */
    public rapidLib: RapidLib;

    /** List of static paths to check */
    private staticFrontPaths: string[];

    /**
     * The entry point for the app. Undefined if it was not loaded yet
     */
    public entryPoint?: Promise<ASLExecutionResult> = undefined;

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
    }

    /** Handle connection upgrade requests */
    public async onUpgrade(req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>) {
        try {
            // Trigger any handlers
            const result = await this.wsRoutes.match(req.url!, req, socket, head, Router.NEXT);
            if (result !== Router.NO_MATCH && result !== Router.NEXT) return;

            // TODO(randomuserhi): Write HTTP header for rejection (e.g code 404 etc...)
            socket.destroy();
        } catch (err) {
            // TODO(randomuserhi): Write HTTP header for rejection (e.g code 500 etc...)
            socket.destroy();
            console.error(err);
        }
    }

    /** Handle requests for the given App */
    public async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse, url: URL) {
        let resourcePath: string | undefined = undefined;

        try {
            // Trigger any handlers
            const router = this.httpRoutes.get(req.method! as RestMethod);
            if (router !== undefined) {
                const result = await router.match(req.url!, req, res, url, Router.NEXT);
                if (result !== Router.NO_MATCH && result !== Router.NEXT) return;
            }

            // Decode URL to get file path
            const decodedURL = decodeURI(req.url!);

            // Locate package resource
            if (req.url !== "/") {
                // Look for resource through static path list
                for (const prefix of this.staticFrontPaths) {
                    resourcePath = Path.join(prefix, decodedURL);

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
                const match = filePrefixMatch(decodedURL, paths);
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

            // If front doesnt have it, check flex
            if (config.flex?.paths !== undefined) {
                const paths = config.flex.paths;
                const match = filePrefixMatch(decodedURL, paths);
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
    /** 
     * Stores currently running app instances
     */
    private apps = new Map<string, RapidApp>();

    /** 
     * Maps a module to its app.
     * Used such that each module can be associated with its running app.
     */
    private midToApp = new Map<ASLModuleId, RapidApp>();

    /** ASL environment */
    private environment = new ASLEnvironment();

    /** Set of packages that are being watched */
    private readonly watchList = new Map<string, PackageInfo>();

    /** Registry of packages */
    public readonly packageRegistry: PackageRegistry;

    /** Watch builder for automatically building packages */
    public readonly packageWatchBuilder: PackageWatchBuilder;

    /** Builder for building packages without watcher */
    public readonly packageBuilder: PackageBuilder;

    /** Internal web socket server for rapid's standard library */
    private webSocketServer: WebSocketServer = new WebSocketServer({ noServer: true });

    /**
     * 
     * @param directories 
     * @param typeDir 
     */
    public constructor(directories: string[], typeDir: string) {
        // Resolve directory paths
        for (let i = 0; i < directories.length; ++i) {
            directories[i] = Path.resolve(directories[i]);
        }

        this.packageRegistry = new PackageRegistry(directories);
        this.packageWatchBuilder = new PackageWatchBuilder(this.packageRegistry, typeDir);
        this.packageBuilder = new PackageBuilder(typeDir);

        // Error diagnostics
        this.packageWatchBuilder.reportDiagnostic = (diagnostic) => {
            const message = Ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

            if (diagnostic.file) {
                const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
                    diagnostic.start!
                );
                const fileName = diagnostic.file.fileName;
                console.log(`${fileName} (${line + 1},${character + 1}): ${message}`);
            } else {
                console.log(message);
            }
        };

        // setup ASL environment
        this.environment.importHook = this.aslImportHook.bind(this);

        // Manage invalidation on watcher builds
        const directoryPatterns: MapLike<string> = {};
        for (const directory of directories) {
            directoryPatterns[normalizePathPattern(Path.join(directory, "*"))] = directory;
        }
        this.packageWatchBuilder.onIncrementalBuild = (paths) => {
            if (paths.length === 0) return;

            registry.invalidate(paths);

            const events: { route: string }[] = [];

            // Convert paths to URLs to invalidate frontend
            for (let path of paths) {
                path = normalizePathPattern(path);

                // Find best matching directory
                const match = filePrefixMatch(path, directoryPatterns);
                if (match === undefined) continue;

                // Construct route 
                const parts = match.postfix.split("/");

                // Ignore backend files
                if (parts[2] === "back") continue;

                // Remove .build/flex or .build/front part from path
                parts.splice(1, 2); 
                const route = "/" + parts.join("/");

                events.push({ route });
            }

            if (events.length > 0) this.broadcast("hotReload", events);
        };
    }

    /**
     * Cleans all packages
     */
    public async cleanAll() {
        const jobs: Promise<void>[] = [];
        for (const directory of this.packageRegistry.directories) {
            for (const entry of await File.readdir(directory, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;

                jobs.push(this.packageRegistry.findPckg(entry.name).then(info => {
                    if (info) {
                        cleanPackage(this.packageRegistry, info, { cleanConfigFiles: true });
                    }
                    console.log(`Cleaned ${entry.name}`);
                }));
            }
        }
        await Promise.all(jobs);
    }

    /**
     * Builds all packages
     */
    public async buildAll() {
        const jobs: Promise<void>[] = [];
        for (const directory of this.packageRegistry.directories) {
            for (const entry of await File.readdir(directory, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;

                jobs.push(this.packageRegistry.findPckg(entry.name).then(info => {
                    if (info) {
                        this.packageBuilder.build(this.packageRegistry, info);
                    }
                    console.log(`Built ${entry.name}`);
                }));
            }
        }
        await Promise.all(jobs);
    }

    /**
     * Loads the entry point for a given app if it has not been loaded already.
     * 
     * @param app
     */
    private async loadEntry(app: RapidApp) {
        if (app.entryPoint !== undefined) {
            // If we already have an entry point, check it loaded properly
            // If it has, then we do not need to load it again.
            const result = await app.entryPoint;
            if (result.ok()) return;
        }

        // Otherwise load the entry point

        const config = await app.pckgInfo.config(this.isWatching(app.pckgInfo));
        let entry = config.back?.entry;
        if (entry !== undefined) {
            entry = Path.join(app.pckgInfo.baseDir, ".build", "back", ASLPath.fixASLExt(entry));
            
            // Ensure to associate the entry point with this app
            this.midToApp.set(registry.getMid(entry), app);
            
            app.entryPoint = this.environment.fetch(entry);
            
            // Wait for execution to complete
            try {
                await app.entryPoint;
            } catch(err) {
                console.error(`Failed to launch entrypoint for '${app.pckgInfo.name}': `, err);
                app.entryPoint = undefined;
            } 
        }
    }

    /** 
     * Helper for asl import hook, resolves the initial path 
     * 
     * @returns The regular import hook result as well as the package info of the app the imported module belongs to.
     *          Undefined if the imported module is not associated with an app.
     */
    private async _aslImportHook(module: ASLModuleInfo, path: string): Promise<[string | ASLExports, PackageInfo | undefined]> {
        path = ASLPath.fixASLExt(path);

        // Get the module's associated app
        const app = this.midToApp.get(module.mid);
        if (app === undefined) {
            throw new Error(`Could not find module's associated app: ${module.path}`);
        }

        const {
            baseDir,
            buildDir
        } = app.pckgInfo;

        if (path.startsWith(".")) {
            // Handle relative import

            // Construct the full path given the module path
            const fullPath = Path.resolve(Path.join(module.dir, path));

            // If it exists, return the path
            if (await fileExists(fullPath)) return [fullPath, app.pckgInfo];

            let resolvedPath: string;

            // Otherwise, resolve the path by checking build / non-build directory paths
            // depending on which we started in
            const inBuildDir = fullPath.startsWith(buildDir);
            if (inBuildDir) {
                // If we are in build directory check non build directory
                const relPath = Path.relative(buildDir, fullPath);
                resolvedPath = Path.join(baseDir, relPath);
                if (await fileExists(resolvedPath)) return [resolvedPath, app.pckgInfo];
            } else {
                // If we are in non build directory check build directory
                const relPath = Path.relative(baseDir, fullPath);
                resolvedPath = Path.join(buildDir, relPath);
                if (await fileExists(resolvedPath)) return [resolvedPath, app.pckgInfo];
            }
        } else if (Path.extname(path) === "") {
            // For non-relative imports with no extension, just do a basic require
            // This is for standard library node modules like "path" or "file" etc...

            // Since module resolution is typically handled by unix paths, convert backslash to unix style slashes
            // path = path.replaceAll("\\", "/");

            // Special case for rapidlib:
            if (ASLPath.first(path) === "rapid") {
                return [app.rapidLib.resolve(path), undefined];
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return [require(path), undefined];
        } else {
            // Resolve absolute paths

            // Check package path (if it is a dependency import)
            const pckgName = ASLPath.first(path);

            // Special case for rapidlib:
            if (pckgName === "rapid") {
                return [app.rapidLib.resolve(path), undefined];
            }

            const pckgInfo = await this.packageRegistry.findPckg(pckgName);
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
                    if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                    
                    // Otherwise check base folder
                    resolvedPath = Path.join(backDir, path);
                    if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                    
                    // Otherwise check flex build folder
                    resolvedPath = Path.join(flexBuildDir, path);
                    if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                    
                    // Otherwise check flex folder
                    resolvedPath = Path.join(flexDir, path);
                    if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                }

                const config = await pckgInfo.config(this.isWatching(app.pckgInfo));

                // Otherwise check package paths
                if (config.back?.paths !== undefined) {
                    const paths = config.back.paths;
                    const match = filePrefixMatch(path, paths);
                    if (match !== undefined) {
                        for (const path of paths[match.pattern]) {
                            let resolvedPath: string;
                            if (Path.basename(path) === "*") {
                                resolvedPath = Path.join(pckgInfo.baseDir, Path.dirname(path), match.postfix);
                            } else {
                                resolvedPath = Path.join(pckgInfo.baseDir, path);
                            }
                            if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                        }
                    }
                }

                // Finally check flex package paths
                if (config.flex?.paths !== undefined) {
                    const paths = config.flex.paths;
                    const match = filePrefixMatch(path, paths);
                    if (match !== undefined) {
                        for (const path of paths[match.pattern]) {
                            let resolvedPath: string;
                            if (Path.basename(path) === "*") {
                                resolvedPath = Path.join(pckgInfo.baseDir, Path.dirname(path), match.postfix);
                            } else {
                                resolvedPath = Path.join(pckgInfo.baseDir, path);
                            }
                            if (await fileExists(resolvedPath)) return [resolvedPath, pckgInfo];
                        }
                    }
                }
            }
        }

        throw new Error(`Could not find: ${path}`);
    }

    /** Import hook to resolve ASL environment paths */
    private async aslImportHook(module: ASLModuleInfo, path: string): Promise<string | ASLExports> {
        const [resolved, pckgInfo] = await this._aslImportHook(module, path);
        if (pckgInfo !== undefined && typeof resolved === "string" && ASLPath.extname(resolved) === ASL_EXTENSION_JS) {
            // Map mid to a rapid app

            let app = this.apps.get(pckgInfo.name);
            if (app === undefined) {
                // auto watch imported apps
                this.watch(pckgInfo.name);

                // launch app if needed
                app = new RapidApp(this, pckgInfo);
                this.apps.set(pckgInfo.name, app);
            }

            this.midToApp.set(registry.getMid(resolved), app);
        }

        return resolved;
    }

    /**
     * Broadcast a message on the rapid websocket to all clients
     * 
     * @param route 
     * @param body 
     */
    // TODO(randomuserhi): A more sophisticated web socket API
    private broadcast(route: string, body: any) {
        for (const client of this.webSocketServer.clients) {
            if (client.readyState !== client.OPEN) continue;
            client.send(JSON.stringify({
                pckg: "rapid",
                route,
                body
            }));
        }
    }

    /** Handle connection upgrade requests */
    private async onUpgrade(req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>) {
        try {
            const pckgNameLocation = ASLPath.findFirst(req.url!);
            if (pckgNameLocation === undefined) {
                // TODO(randomuserhi): Write HTTP header for rejection (e.g code 404 etc...)
                socket.destroy();
                return;
            }

            let pckgName = decodeURI(req.url!.slice(pckgNameLocation.start, pckgNameLocation.end));
            const pckgUrl = req.url!.slice(pckgNameLocation.end);

            // if file system is not case sensitive, resolve package names as always lower-case
            if (!CASE_SENSITIVE_FS) pckgName = pckgName.toLowerCase();

            // Special case for standard library
            if (pckgName === "rapid") {
                this.webSocketServer.handleUpgrade(req, socket, head, (ws) => {
                    // emit connection event
                    this.webSocketServer.emit("connection", ws, req);
                });
                return;
            }
    
            const instance = this.apps.get(pckgName);
            if (instance === undefined) {
                // TODO(randomuserhi): Write HTTP header for rejection (e.g code 404 etc...)
                socket.destroy();
                return;
            }
    
            // Pass request onto the given package
            req.url = pckgUrl;
            instance.onUpgrade(req, socket, head);
        } catch(err) {
            // TODO(randomuserhi): Write HTTP header for rejection (e.g code 500 etc...)
            socket.destroy();
            console.error(err);
        }
    }

    private async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        try {
            // TODO(randomuserhi): Implement redirect on basic case for "/"
            //                     User can specify what they want for the default app

            const pckgNameLocation = ASLPath.findFirst(req.url!);
            if (pckgNameLocation === undefined) {
                res.statusCode = 404;
                res.end("Not valid URL");
                return;
            }

            let pckgName = decodeURI(req.url!.slice(pckgNameLocation.start, pckgNameLocation.end));
            const pckgUrl = req.url!.slice(pckgNameLocation.end);

            // if file system is not case sensitive, resolve package names as always lower-case
            if (!CASE_SENSITIVE_FS) pckgName = pckgName.toLowerCase();

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
    
            let app = this.apps.get(pckgName);
            if (app === undefined) {
                const pckgInfo = await this.packageRegistry.findPckg(pckgName);
                if (pckgInfo === undefined) {
                    res.statusCode = 404;
                    res.end("Not valid package");
                    return;
                }
    
                // Check again incase 2 async calls reach here at the same time
                app = this.apps.get(pckgName);
                if (app === undefined) {
                    // Auto watch launched apps
                    this.watch(pckgInfo.name);
        
                    // Launch app instance
                    app = new RapidApp(this, pckgInfo);
                    this.apps.set(pckgName, app);
                }
            }

            // Ensure app's entry point is fully loaded before proceeding
            await this.loadEntry(app);
    
            // Pass request onto the given package
            const url = new URL(req.url!, "https://localhost.rapid/");
            req.url = pckgUrl;
            app.onRequest(req, res, url);
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
        // TODO(randomuserhi): Guard against server & websocket already being enabled (aka stop 2 listen calls)

        return new Promise((resolve) => {
            const server = Http.createServer(this.onRequest.bind(this)).listen(port, resolve);
            server.on("upgrade", this.onUpgrade.bind(this));
        });
    }
}