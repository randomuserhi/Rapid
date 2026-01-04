import { ASL_CONFIG, ASL_RUNTIME_HOOK_NAME, ASLEnvironment, ASLModuleId, ASLPath, defaultImportHook, registry } from "/rapid/ASLRuntime.mjs";
import { Router } from "/rapid/Router.mjs";

// Rapid lib exports

/**
 * For a given function, creates a bound function that has the same body as the original function.
 * The this object of the bound function is associated with the specified object, and has the specified initial parameters.
 * 
 * This is used over `Function.prototype.bind` as it has arrow function semantics which optimize better.
 * It is also used over an inline arrow function as it doesnt capture unnecessary variables due to scoping.
 * 
 * @param func The function to bind
 * @param args Arguments to bind to the parameters of the function.
 */
export function bind<A extends any[], B extends any[], R>(func: (...args: [...A, ...B]) => R, ...args: A): (...args: B) => R {
    return (...remaining: B) => func(...args, ...remaining);
}

/**
 * App object for rapid standard library
 */
class App {
    readonly name: string;
    readonly baseURL: string;

    constructor(name: string, baseURL?: string) {
        if (name === "") throw new Error("App cannot have empty name.");
        
        this.name = name;
        this.baseURL = `${window.location.origin}/${this.name}/`;
        if (baseURL !== undefined) {
            if (!baseURL.endsWith("/")) baseURL += "/";
            this.baseURL = new URL(baseURL, this.baseURL).toString();
        }
    }
}

export function __linkRapidApp(app: App, exports: any) {
    return {
        ...exports,
        app
    };  
}

// Setup ASL

ASL_CONFIG.baseURL = new URL(window.location.origin);

// TODO(randomuserhi): Fetch request from backend whether it is case sensitive or not via a Get Request
//                     This must be awaited on as we cannot continue until we know if paths are case
//                     sensitive or not to prevent malforming the registry.
ASL_CONFIG.isCaseSensitive = false;

// Load config and trigger entry point as required

interface RapidConfig {
    entry?: string;
    baseURL?: string;
}

const rapid: RapidConfig = (window as any).rapid;
if (rapid !== undefined) {
    if (rapid.entry !== undefined && typeof rapid.entry === "string") {
        const midToApp = new Map<ASLModuleId, App>();
        
        const env = new ASLEnvironment();
        
        env.importHook = async (module, path) => {
            path = ASLPath.fixASLExt(path);
    
            if (!path.startsWith(".")) {
                // Resolve non-relative imports

                // Check whether path resolves to the same base URL
                // if not, then its a full URL to an external resource and we should not handle it
                const url = new URL(path, ASL_CONFIG.baseURL);
                if (url.origin === ASL_CONFIG.baseURL?.origin) {
                    // Get pathname as it ensure path forms a valid url
                    path = url.pathname;
        
                    // Resolve rapidlib paths
                    if (ASLPath.first(path) === "rapid") {
                        // Amend extension if none is given, all rapidlib paths are .mjs scripts
                        // so we can accept no extension and implicitly add extension
                        if (!ASLPath.endsWithSeparator(path) && ASLPath.extname(path) === "") path += ".mjs";
        
                        // Import directly
                        let obj = await import(new URL(path, ASL_CONFIG.baseURL).toString()); 
        
                        // Trigger App link hook so rapid standard library functions
                        // know what app they are associated with
                        if (Object.prototype.hasOwnProperty.call(obj, ASL_RUNTIME_HOOK_NAME)) {
                            let app = midToApp.get(module.mid);
                            if (app === undefined) {
                                // Launch app if necessary
                                let name = ASLPath.first(new URL(module.path).pathname);
                                if (!ASL_CONFIG.isCaseSensitive) name = name.toLowerCase();

                                app = new App(name);
                                
                                midToApp.set(module.mid, app);
                            }

                            obj = obj[ASL_RUNTIME_HOOK_NAME](app, obj);
                        }
        
                        return obj;
                    }
                }
            }
    
            return await defaultImportHook(module, path);
        };
    
        // Load entry point
        const entryPoint = ASLPath.fixASLExt(rapid.entry);
        const app = new App(ASLPath.first(window.location.pathname), rapid.baseURL);
        midToApp.set(registry.getMid(entryPoint), app);
        env.fetch(new URL(entryPoint, app.baseURL).toString());

        // TODO(randomuserhi): More sophisticated web socket API

        // Internal web socket router
        const router = new Router<[body: any]>();
        router.add("hotReload", (match, files: { route: string }[]) => {
            const paths = [];
            for (const path of files) {
                paths.push(new URL(path.route, window.location.origin).toString());
            }
            registry.invalidate(paths);

            // NOTE(randomuserhi): This relies on package file path routing
            //                     To get custom routing to work, asl file fetches need to map URL -> Path on disk
            //                     This way when hot reload event comes in for a Path on disk, all associated URLs can also
            //                     be invalidated
            // TODO(randomuserhi): Change web invalidation to be handled using Path on disk, and associate URLs with said paths
            //                     as described above
        });

        // Try connecting to socket - need a reconnect ability if socket closes
        const ws = new WebSocket(`ws://${window.location.host}/rapid`);
        ws.onmessage = (ev => {
            const data: {
                pckg: string,
                route: string,
                body: any
            } = JSON.parse(ev.data);

            // Ignore messages that are not from rapid package
            if (data.pckg !== "rapid") return;

            // Trigger router callbacks
            router.match(data.route, data.body);
        });
    }
}