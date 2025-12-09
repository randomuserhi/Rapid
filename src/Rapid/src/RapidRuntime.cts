import File from "fs/promises";
import FileSync from "fs";
import Http from "http";
import Path from "path";
import { ASLEnvironment, registry } from "./ASL/ASLRuntime.cjs";
import { PackageConfig, PackageInfo, PackageManager, PackageRegistry } from "./PackageManager.cjs";

// TODO(randomuserhi): Documentation & Code cleanup

//

const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);
const fileExistsSync = (path: string) => FileSync.existsSync(path);

function createEnvironment(instance: PackageInstance, packageRegistry: PackageRegistry, pckg: PackageInfo): ASLEnvironment {
    const env = new ASLEnvironment();

    // environment variables (TODO(randomuserhi): dir paths should be part of PackageInfo)
    const buildDir = Path.resolve(Path.join(pckg.baseDir, ".build"));
    const root = Path.join(pckg.baseDir, "back");
    const rootBuild = Path.join(pckg.baseDir, ".build", "back");
    const flex = Path.join(pckg.baseDir, "flex");
    const flexBuild = Path.join(pckg.baseDir, ".build", "flex");

    const front = Path.join(pckg.baseDir, "front");
    const frontBuild = Path.join(pckg.baseDir, ".build", "front");

    // TODO(randomuserhi): Make this lib object properly, instead of just passing the instance
    const rapid = {
        app: instance,
        paths: {
            frontSync: (...parts: string[]) => {
                let p = Path.join(frontBuild, ...parts);

                if (fileExistsSync(p)) return p;
                p = Path.join(front, ...parts);
                if (fileExistsSync(p)) return p;

                p = Path.join(flexBuild, ...parts);
                if (fileExistsSync(p)) return p;
                p = Path.join(flex, ...parts);
                if (fileExistsSync(p)) return p;

                throw new Error("Resource does not exist");
            },
            front: async (...parts: string[]) => {
                let p = Path.join(frontBuild, ...parts);

                if (await fileExists(p)) return p;
                p = Path.join(front, ...parts);
                if (await fileExists(p)) return p;

                p = Path.join(flexBuild, ...parts);
                if (await fileExists(p)) return p;
                p = Path.join(flex, ...parts);
                if (await fileExists(p)) return p;

                throw new Error("Resource does not exist");
            }
        }
    };

    env.importHook = async (module, path) => {
        path = Path.normalize(path);

        if (path.startsWith(".")) {
            // relative import

            // Check if it is really relative
            if (await fileExists(path)) return path;

            const fullPath = Path.resolve(Path.join(module.dir, path));

            const inBuildDir = fullPath.startsWith(buildDir);
            const inFlexDirectory = inBuildDir ? fullPath.startsWith(flexBuild) : fullPath.startsWith(flex);

            let p: string;
            if (inBuildDir) {
                // If we are in build directory check non build directory
                const relPath = Path.relative(buildDir, fullPath);
                p = Path.join(pckg.baseDir, relPath);
                if (await fileExists(p)) return p;
            } else {
                // If we are in non build directory check build directory
                const relPath = Path.relative(pckg.baseDir, fullPath);
                p = Path.join(buildDir, relPath);
                if (await fileExists(p)) return p;
            }

            // If we still can't find it, check flex directories
            if (inFlexDirectory) {
                const relPath = inBuildDir ? Path.relative(rootBuild, fullPath) : Path.relative(root, fullPath);

                // Check flex build path
                p = Path.join(flexBuild, relPath);
                if (await fileExists(p)) return p;

                // Check flex path
                p = Path.join(flex, relPath);
                if (await fileExists(p)) return p;
            }
        } else if (Path.extname(path) === "") {
            // For non-relative imports with no extension, just do a basic require
            // This is for standard library node modules like "path" or "file" etc...

            // Since module resolution is typically handled by unix paths, convert backslash to unix style slashes
            path = path.replace("\\", "/");

            // TODO(randomuserhi): cleanup
            if (path === "rapid") return rapid;

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require(path);
        } else {
            // Check if it is in root build folder first
            let p = Path.join(rootBuild, path);
            if (await fileExists(p)) return p;

            // Otherwise check flex build folder
            p = Path.join(flexBuild, path);
            if (await fileExists(p)) return p;

            // Otherwise check root folder
            p = Path.join(root, path);
            if (await fileExists(p)) return p;

            // Otherwise check flex folder
            p = Path.join(flex, path);
            if (await fileExists(p)) return p;

            // Check package path
            const parts = path.split(Path.sep);
            const pckg = parts[0];
            const version = parts[1];

            const pckgInfo = await packageRegistry.get(pckg);
            if (pckgInfo !== undefined) {
                const pckgRoot = Path.join(pckgInfo.baseDir, "back");
                const pckgRootBuild = Path.join(pckgInfo.baseDir, ".build", "back");
                const pckgFlex = Path.join(pckgInfo.baseDir, "flex");
                const pckgFlexBuild = Path.join(pckgInfo.baseDir, ".build", "flex");

                path = Path.relative(Path.join(pckg, version), path);

                // Check if it is in root build folder first
                p = Path.join(pckgRootBuild, path);
                if (await fileExists(p)) return p;

                // Otherwise check flex build folder
                p = Path.join(pckgFlexBuild, path);
                if (await fileExists(p)) return p;

                // Otherwise check root folder
                p = Path.join(pckgRoot, path);
                if (await fileExists(p)) return p;

                // Otherwise check flex folder
                p = Path.join(pckgFlex, path);
                if (await fileExists(p)) return p;
            }
        }

        throw new Error(`Could not find: ${path}`);
    };

    return env;
}

//

type RestMethod = "GET" | "POST";

interface Route {
    path: string;
    method: RestMethod;
    handler: (req: Http.IncomingMessage, res: Http.ServerResponse) => void;
}

export class PackageInstance {
    private rapid: RapidRuntime;

    private pckg: PackageInfo;

    // TODO(randomuserhi): Move this info to PackageInfo
    private frontDir: string;
    private frontBuildDir: string;

    // TODO(randomuserhi): Move this info to PackageInfo
    private flexDir: string;
    private flexBuildDir: string;

    private environment: ASLEnvironment;

    constructor(rapid: RapidRuntime, pckg: PackageInfo) {
        this.rapid = rapid;
        this.pckg = pckg;

        this.frontDir = Path.join(pckg.baseDir, "front");
        this.frontBuildDir = Path.join(pckg.baseDir, ".build", "front");

        this.flexDir = Path.join(pckg.baseDir, "flex");
        this.flexBuildDir = Path.join(pckg.baseDir, ".build", "flex");

        this.environment = createEnvironment(this, rapid.packageRegistry, pckg);
    }

    public async loadEntry() {
        const config: PackageConfig = JSON.parse(await File.readFile(this.pckg.configPath, "utf-8"));
        let entryPoint = config.back?.entry;
        if (entryPoint !== undefined) {
            entryPoint = Path.join(this.pckg.baseDir, ".build", "back", entryPoint);
            await this.environment.fetch(entryPoint);
        }
    }

    private routes = new Map<RestMethod, Map<string, Route>>();

    public get(path: string, cb: (req: Http.IncomingMessage, res: Http.ServerResponse) => void) {
        let group = this.routes.get("GET");
        if (group === undefined) {
            group = new Map();
            this.routes.set("GET", group);
        }

        group.set(path, {
            path,
            method: "GET",
            handler: cb
        });
    }

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
        let p = Path.join(this.frontBuildDir, req.url!);

        if (!await fileExists(p)) {
            p = Path.join(this.frontDir, req.url!);
            if (!await fileExists(p)) {
                // Check flex dir
                p = Path.join(this.flexBuildDir, req.url!);
                if (!await fileExists(p)) {
                    p = Path.join(this.flexDir, req.url!);
                }
            }
        }

        if (!await fileExists(p)) {
            // Otherwise return 404 not found
            res.statusCode = 404;
            res.end("Not Found");
            return;
        }

        // Serve resource
        // TODO(randomuserhi): cleanup
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
        const extname: keyof typeof mimeTypes = Path.extname(p).toLowerCase() as any;

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        try {
            const content = await File.readFile(p);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        } catch (err) {
            res.statusCode = 500;
            res.end("Error 500");
            console.error(err);
        }
    }
}

export class RapidRuntime {
    private instances = new Map<string, PackageInstance>();

    public packageRegistry: PackageRegistry;

    public packageManager: PackageManager;

    public constructor(directories: string[], typeDir: string) {
        this.packageRegistry = new PackageRegistry(directories);
        this.packageManager = new PackageManager(this.packageRegistry, typeDir);

        this.packageManager.builder.onASLTranspiled = async (paths) => {
            registry.invalidate(paths);
        };
    }

    private async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        // TODO(randomuserhi): Implement redirect on basic case for "/"
        //                     User can specify what they want for the default app

        // TODO(randomuserhi): Redirect "localhost:3000/pckg" links to "localhost:3000/pckg/" otherwise relative imports fail:
        //                     <script src="./script.js"> on "localhost:3000/pckg" resolves to "localhost:3000/script.js"
        //                     but on "localhost:3000/pckg/" it resolves to "localhost:3000/pckg/script.js" properly

        // Obtain package from request
        const parts = req.url!.split("/");
        if (parts.length < 2) {
            res.statusCode = 404;
            res.end("Not valid URL");
            return;
        }

        const pckg = decodeURI(parts[1]);
        if (pckg === "") {
            res.statusCode = 404;
            res.end("Not valid URL");
            return;
        }

        const pckgPath = `/${pckg}`;

        let instance = this.instances.get(pckgPath);
        if (instance === undefined) {
            const pckgInfo = await this.packageRegistry.get(pckg);
            if (pckgInfo === undefined) {
                res.statusCode = 404;
                res.end("Not valid package");
                return;
            }

            // Auto watch package
            await this.packageManager.watch(pckgInfo);

            instance = new PackageInstance(this, pckgInfo);
            await instance.loadEntry();

            this.instances.set(pckgPath, instance);
        }

        req.url = new URL(req.url!.replace(pckgPath, ""), "https://localhost/").pathname;
        instance.onRequest(req, res);
    }

    public listen(port: number): Promise<void> {
        return new Promise((resolve) => {
            Http.createServer(this.onRequest.bind(this)).listen(port, resolve);
        });
    }
}