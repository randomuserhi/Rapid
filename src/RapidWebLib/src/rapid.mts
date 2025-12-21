import { ASLEnvironment, ASLModuleId, ASLPath, defaultImportHook, getASLBaseURL, registry, setASLBaseURL, setASLIsCaseSensitive } from "/rapid/ASLRuntime.mjs";
import { Router } from "/rapid/Router.mjs";

const APP_LINK_HOOK = "__linkRapidApp";

/**
 * App object for rapid standard library
 */
class App {
    readonly name: string;
    readonly baseURL: string;

    constructor(name: string) {
        if (name === "") throw new Error("App cannot have empty name.");
        
        this.name = name;
        this.baseURL = `${window.location.origin}/${this.name}/`;
    }
}

export function __linkRapidApp(app: App, exports: any) {
    return {
        ...exports,
        app
    };  
}

// Setup ASL

setASLBaseURL(window.location.origin);

// TODO(randomuserhi): Fetch request from backend whether it is case sensitive or not via a Get Request
//                     This must be awaited on as we cannot continue until we know if paths are case
//                     sensitive or not to prevent malforming the registry.
const IS_CASE_SENSITIVE = false;
setASLIsCaseSensitive(IS_CASE_SENSITIVE);

// Load config and trigger entry point as required

interface RapidConfig {
    entry?: string;
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
    
                // Ensure path forms a valid url, it must start with a `/`
                if (ASLPath.startsWithSeparator(path)) path = "/" + path;
    
                // Resolve rapidlib paths
                if (ASLPath.first(path) === "rapid") {
                    // Amend extension if none is given, all rapidlib paths are .mjs scripts
                    // so we can accept no extension and implicitly add extension
                    if (!ASLPath.endsWithSeparator(path) && ASLPath.extname(path) === "") path += ".mjs";
    
                    // Import directly
                    let obj = await import(new URL(path, getASLBaseURL()).toString()); 
    
                    // Trigger App link hook so rapid standard library functions
                    // know what app they are associated with
                    if (Object.prototype.hasOwnProperty.call(obj, APP_LINK_HOOK)) {
                        let app = midToApp.get(module.mid);
                        if (app === undefined) {
                            // Launch app if necessary
                            let name = ASLPath.first(new URL(module.path).pathname);
                            if (!IS_CASE_SENSITIVE) name = name.toLowerCase();

                            app = new App(name);
                            
                            midToApp.set(module.mid, app);
                        }

                        obj = obj[APP_LINK_HOOK](app, obj);
                    }
    
                    return obj;
                }
            }
    
            return await defaultImportHook(module, path);
        };
    
        // Load entry point
        const entryPoint = ASLPath.fixASLExt(rapid.entry);
        const app = new App(ASLPath.first(window.location.pathname));
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