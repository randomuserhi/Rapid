import Http from "http";
import File from "fs/promises";
import Path from "path";
import { PackageConfig, PackageInfo, PackageManager, PackageRegistry } from "./PackageManager.cjs";
import { ASLEnvironment, registry } from "./ASL/ASLRuntime.cjs";

// TODO(randomuserhi): Documentation & Code cleanup

//

function createEnvironment(instance: PackageInstance, packageRegistry: PackageRegistry, pckg: PackageInfo): ASLEnvironment {
    const env = new ASLEnvironment();

    // TODO(randomuserhi): Make this lib object properly, instead of just passing the instance
    const rapid = instance;

    // environment variables
    const buildDir = Path.resolve(Path.join(pckg.baseDir, ".build"));
    const root = Path.join(pckg.baseDir, "back");
    const rootBuild = Path.join(pckg.baseDir, ".build", "back");
    const flex = Path.join(pckg.baseDir, "flex");
    const flexBuild = Path.join(pckg.baseDir, ".build", "flex");

    const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

    env.importHook = async (module, path) => {
        path = Path.normalize(path);

        if (path.startsWith(".")) {
            // relative import

            // Check if it is really relative
            if (await fileExists(path)) return path;

            const fullPath = Path.resolve(Path.join(module.dir, path));

            if (fullPath.startsWith(buildDir)) {
                // If we are in build directory check non build directory
                const relPath = Path.relative(buildDir, fullPath);
                return Path.join(pckg.baseDir, relPath);
            } else {
                // If we are in non build directory check build directory
                const relPath = Path.relative(pckg.baseDir, fullPath);
                return Path.join(buildDir, relPath);
            }
        } else if (Path.extname(path) === "") {
            // For non-relative imports with no extension, just do a basic require
            // This is for standard library node modules like "path" or "file" etc...

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

    private environment: ASLEnvironment;

    constructor(rapid: RapidRuntime, pckg: PackageInfo) {
        this.rapid = rapid;
        this.pckg = pckg;

        this.environment = createEnvironment(this, rapid.packageRegistry, pckg);
    }

    public async loadEntry() {
        const config: PackageConfig = JSON.parse(await File.readFile(this.pckg.configPath, "utf-8"));
        let entryPoint = config.back?.entry;
        if (entryPoint !== undefined) {
            entryPoint = Path.join(this.pckg.baseDir, ".build", "back", entryPoint);
            this.environment.fetch(entryPoint);
        }
    }

    private routes = new Map<RestMethod, Map<string, Route>>();

    public onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        // Trigger any handlers
        const group = this.routes.get(req.method! as RestMethod);
        if (group !== undefined) {
            const route = group.get(req.url!);
            if (route !== undefined) {
                route.handler(req, res);
                return;
            }
        }

        // Otherwise return 404 not found
        res.statusCode = 404;
        res.end("Not Found");
    }
}

export class RapidRuntime {
    private instances = new Map<string, PackageInstance>();

    public packageRegistry: PackageRegistry;

    public packageManager: PackageManager;

    public constructor(directories: string[], typeDir: string) {
        this.packageRegistry = new PackageRegistry(directories);
        this.packageManager = new PackageManager(this.packageRegistry, typeDir);

        // Collects built files and groups them into a single registry invalidation  
        let collector: string[] = [];
        let lastCollect = Date.now();
        this.packageManager.builder.onASLTranspiled = (path) => {
            collector.push(path);
            lastCollect = Date.now();

            setTimeout(() => {
                const now = Date.now();
                if (now - lastCollect > 50 && collector.length > 0) {
                    registry.invalidate(collector);
                    collector = [];
                }
            }, 100);
        };
    }

    private async onRequest(req: Http.IncomingMessage, res: Http.ServerResponse) {
        // TODO(randomuserhi): Implement redirect on basic case for "/"
        //                     User can specify what they want for the default app

        // Obtain package from request
        const parts = req.url!.split("/");
        if (parts.length < 2) return;

        const pckg = decodeURI(parts[1]);
        if (pckg === "") return;

        const pckgPath = `/${pckg}`;

        let instance = this.instances.get(pckgPath);
        if (instance === undefined) {
            const pckgInfo = await this.packageRegistry.get(pckg);
            if (pckgInfo === undefined) return;

            // Auto watch package
            this.packageManager.watch(pckgInfo);

            instance = new PackageInstance(this, pckgInfo);
            await instance.loadEntry();

            this.instances.set(pckgPath, instance);
        }

        req.url = req.url!.replace(pckgPath, "");
        instance.onRequest(req, res);
    }

    public listen(port: number): Promise<void> {
        return new Promise((resolve) => {
            Http.createServer(this.onRequest.bind(this)).listen(port, resolve);
        });
    }
}