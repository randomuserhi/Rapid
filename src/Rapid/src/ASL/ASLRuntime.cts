/**
 * Async Script Loader (Node version)
 * 
 * @randomuserhi 2025
 */

// TODO(randomuserhi): Promise and execution probably needs to be refactored.
//                     Currently way to bug-prone when multiple async invalidation calls are made.
//                     Hot reloading should be far more stable - and execution cancellation (on module reloads) needs to be re-thought through
//                     Node JS tends to exit execution on uncaught promise exceptions -> our design doesn't really take this properly into account.
//
//                     Most likely, completely re-write the runtime with a new execution / cancellation architecture

import File from "fs/promises";
import Path from "path";

const noop = () => {};

const CHAR_FORWARD_SLASH = 47; /* / */
const CHAR_DOT = 46; /* . */

/**
 * Replicates behaviour of `path.extname`
 * 
 * From the NodeJS Library https://github.com/nodejs/node/blob/896b75a4da58a7283d551c4595e0aa454baca3e0/lib/path.js
 * 
 * @param path Path
 * @returns File extension
 */
function extname(path: string) {
    if(typeof path !== "string") {
        throw new TypeError(`The "path" argument must be of type string. Received type ${typeof path}`);
    }

    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;
    for(let i = path.length - 1; i >= 0; --i) {
        const code = path.charCodeAt(i);
        if(code === CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if(!matchedSlash) {
                startPart = i + 1;
                break;
            }
            continue;
        }
        if(end === -1) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if(code === CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if(startDot === -1) {
                startDot = i;
            } else if(preDotState !== 1) {
                preDotState = 1;
            }
        } else if(startDot !== -1) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = -1;
        }
    }

    if(startDot === -1 ||
       end === -1 ||
       // We saw a non-dot character immediately before the dot
       preDotState === 0 ||
       // The (right-most) trimmed path component is exactly '..'
       (preDotState === 1 &&
        startDot === end - 1 &&
        startDot === startPart + 1)) {
        return "";
    }
    return path.slice(startDot, end);
}

/**
 * A promise wrapper for promises that can be cancelled.
 */
class CancellablePromise<T> {
    readonly promise: Promise<T>;
    readonly cancel: (reason?: any) => void;
    readonly isCancelled: boolean = false; 
    readonly cancelReason?: any;

    constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void, self: CancellablePromise<T>) => void, oncancel?: (reason?: any) => void) {
        this.cancel = undefined!;
        this.promise = new Promise((resolve, reject) => {
            (this as any).cancel = (reason?: any) => {
                if (this.isCancelled) return;
                (this as any).isCancelled = true;
                (this as any).cancelReason = reason;
                oncancel?.(reason);
                reject(reason);
            };
            executor(resolve, reject, this);
        });
        if (this.cancel === undefined) throw new Error("Could not generate cancel function.");
    }

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    public then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): CancellablePromise<TResult1 | TResult2> {
        return new CancellablePromise((resolve, reject) => {
            this.promise.then(onfulfilled, onrejected).then(resolve, reject);
        }, this.cancel);
    }

    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    public catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): CancellablePromise<T | TResult> {
        return new CancellablePromise((resolve, reject) => {
            this.promise.catch(onrejected).then(resolve, reject);
        }, this.cancel);
    }

    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    public finally(onfinally?: (() => void) | undefined | null): CancellablePromise<T> {
        return new CancellablePromise((resolve) => {
            this.promise.finally(onfinally).then(resolve);
        }, this.cancel);
    }
}

/**
 * Module object, represents exports for a module.
 */
type ASLModuleObject = Record<PropertyKey, any>;

/** Module ID type */
type ASLModuleId = number;

/** Function that imports another module from an ASL module execution context. */
type ASLEnvImportFunc = (module: ASLModule, path: string, options?: ASLImportOptions) => Promise<ASLModuleObject>;

/** Function that imports another module from an ASL module execution context. */
type ASLImportFunc = (path: string, options?: ASLImportOptions) => Promise<ASLModuleObject>;

/**
 * ASL module function.
 * 
 * @param aslImport ASL import function. Used to import other modules.
 * @param module Object containing module information.
 * @param exports Object containing the modules exports.
 */
type ASLModuleFunc = (aslImport: ASLImportFunc, module: any, exports: ASLModuleObject) => Promise<void>;

/**
 * Import options when using `require` in an ASL script
 * NOTE(randomuserhi): currently unused
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ASLImportOptions {
}

/**
 * ASLModule information.
 * 
 * Contains information about the module, such as its archetype and execution function.
 */
class ASLModule {
    /** Module path (normalized) */
    readonly path: string;

    /** Module directory */
    readonly dir: string;

    /** Module id */
    readonly mid: ASLModuleId;

    /**
     * Executes the given module, returning the module object containing its exports.
     */
    readonly exec: (aslImport: any) => Promise<ASLModuleObject> = undefined!;

    constructor(mid: ASLModuleId, path: string) {
        this.path = path;
        this.dir = Path.dirname(this.path);

        this.mid = mid;
    }
}

/**
 * Stores a cache of loaded modules.
 * 
 * Manages cache invalidation as well as hot reloading.
 */
class ASLRegistry {
    /** 
     * Module path to module-id map. 
     * 
     * We use id aliases for modules as they are shorter and can be easily casted to string keys.
     */
    private readonly mid = new Map<string, ASLModuleId>();

    /**
     * Module id to path.
     */
    private readonly paths = new Map<ASLModuleId, string>();

    /**
     * Internal id counter.
     */
    private _mid = 0;

    /**
     * Get the module id for a given module file.
     * If the file has not been registered yet, assigns a new id.
     * 
     * @param path Path to module file.
     * @returns module id
     */
    public getMid(path: string) {
        // Normalize path
        path = Path.normalize(path);

        let mid = this.mid.get(path);
        if (mid === undefined) {
            mid = this._mid++;

            this.mid.set(path, mid);
            this.paths.set(mid, path);
        }
        return mid;
    }

    /**
     * Get the module path for a given module id.
     * 
     * @param mid Module id
     * @returns path (or undefined if module id does not exist)
     */
    public getPath(mid: ASLModuleId) {
        return this.paths.get(mid);
    }

    /** Module cache. Maps module file path to the cached module info. */
    private readonly cache = new Map<ASLModuleId, ASLModule>();

    /** Stores pending fetch requests for modules. */
    private readonly pending = new Map<ASLModuleId, CancellablePromise<ASLModule>>();

    /** 
     * Dependency map of module to ASL environment.
     * 
     * When a given module is hot reloaded, we know which environments are affected.
     */
    private readonly dependencies = new Map<ASLModuleId, Set<ASLEnvironment>>();

    /**
     * Loads a module into cache.
     * 
     * @param mid module id to fetch
     * @param env Environment that is fetching the module - used internally for book keeping dependencies for hot reloading
     * @returns The loaded module information
     */
    public fetch(mid: ASLModuleId, env?: ASLEnvironment): CancellablePromise<ASLModule> {
        const path = this.paths.get(mid);
        if (path === undefined) throw new Error(`Failed to obtain path for module id: ${mid}`);

        // Add dependency
        if (env !== undefined) {
            let dependencySet = this.dependencies.get(mid);
            if (dependencySet === undefined) {
                dependencySet = new Set();
                this.dependencies.set(mid, dependencySet);
            }
            dependencySet.add(env);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let promise = this.pending.get(mid);

        if (promise === undefined) {
            // If module is not pending, create the request

            promise = new CancellablePromise<ASLModule>((resolve, reject) => {
                // Try get module from cache
                if (this.cache.has(mid)) {
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    File.readFile(path, { encoding: "utf-8" })
                        .then(code => {
                            // Create module function.
                            // This runs in an async function as ASL needs to support the `await` keyword at the top-level.
                            // The function has the parameters `require`, `module` and `exports` to provide the necessary keywords.
                            //
                            // Note that `require` refers to `aslImport`, in ASL scripts the keyword is `require` for simplicity.
                            const moduleFunc = (new Function(`return (async function(require, module, exports) {\n${code}\n}).bind(undefined); //# sourceURL=${path}`))() as ASLModuleFunc;

                            // Create module info
                            const moduleInfo = new ASLModule(mid, path);
                            (moduleInfo as any).exec = this.execModule.bind(this, moduleInfo, moduleFunc);

                            // Add to cache
                            this.cache.set(mid, moduleInfo);

                            // Resolve request
                            resolve(moduleInfo);
                        })
                        .catch(e => reject(e));
                }
            });

            // Add to map of pending requests
            this.pending.set(mid, promise);

            // When request finishes, remove from pending
            promise.catch(noop).finally(() => {
                // On unload signal, skip handling as it is already handled automatically by ASL synchronously
                // by the `unload` method.
                // 
                // This is because we cannot trust order of execution by JS engine's micro-tasks.
                // Pending needs to be deleted on cancel, before we re-request execution of the modules,
                // but this is not guaranteed if we rely on JS micro-task scheduling.
                if (promise!.cancelReason === ASL_SIGNAL_MODULE_UNLOAD) return;
                
                this.pending.delete(mid);
            });
        }

        return promise;
    }

    /**
     * Proxy handler for `module` metadata object in ASL
     */
    private static moduleProxyHandler: ProxyHandler<any> = {
        set() {
            // silently immutable
            return false;
        }
    } as const;

    /**
     * Executes the given module, providing the necessary parameters.
     * 
     * @param moduleFunc The ASLModuleFunc of the module being executed.
     */
    private execModule(context: ASLModule, moduleFunc: ASLModuleFunc, envImport: ASLEnvImportFunc): Promise<ASLModuleObject> {
        return new Promise((resolve) => {
            let mutable = true;

            const exports = new Proxy<Record<PropertyKey, any>>({}, {
                set(exports, prop, newValue) {
                    if (!mutable) throw new Error(`You cannot alter exports once a module has loaded.`);
                    exports[prop] = newValue;
                    return true;
                }
            });

            const module = new Proxy({
                ready: () => {
                    mutable = false;
                    resolve(exports);
                }
            }, ASLRegistry.moduleProxyHandler);

            moduleFunc(envImport.bind(undefined, context), module, exports)
                .then(() => module.ready())
                .catch((err) => {
                    if (err instanceof ASLExecutionCancelledError) return;
                    if (err === ASL_SIGNAL_MODULE_UNLOAD) return;
                    
                    // TODO(randomuserhi): Better error handling
                    console.error(err);
                });
        });
    }

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param path Module to mark as invalidated
     */
    public invalidate(paths: string[]): void;

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param mid Module to mark as invalidated
     */
    public invalidate(mids: ASLModuleId[]): void;

    public invalidate(list: (ASLModuleId | string)[]): void {
        if (list.length === 0) return;

        // Resolve mids
        const mids = list.map(mid => {
            if (typeof mid === "string") {
                mid = registry.getMid(mid);
            }
            return mid;
        });

        const midsMap = new Map<ASLEnvironment, ASLModuleId[]>();

        for (const mid of mids) {
            // If module is pending, cancel it
            const pending = this.pending.get(mid);
            if (pending !== undefined) {
                pending.cancel(ASL_SIGNAL_MODULE_UNLOAD);

                // We have to immediately remove from pending dict to prevent stack overflow
                // as the `finally()` call won't call until next async event
                this.pending.delete(mid);
            } else if (!this.cache.delete(mid)) {
                // Otherwise, if it is in cache, delete it. If it is not in the cache, 
                // then module was never loaded and we can early return
                continue;
            }

            const dependencies = this.dependencies.get(mid);
            if (dependencies === undefined) continue;

            for (const env of dependencies) {
                let envList = midsMap.get(env);
                if (envList === undefined) {
                    envList = [];
                    midsMap.set(env, envList);
                }
                envList.push(mid);
            }
        }

        // Invalidate from all environments
        for (const [env, envList] of midsMap.entries()) {
            env.invalidate(envList);
        }
    }
}

/**
 * The global registry of loaded modules.
 * 
 * Keeps track of which environments depend on which modules for hot reloading.
 */
export const registry = new ASLRegistry();

type ASLArchetypeId = string;

/**
 * Descibes the archetype (what modules depend on other modules).
 * Used to manage dependency tree.
 * 
 * Modules are stored using mid instead of their path. 
 * This is because they can be serialized into keys.
 */
class ASLArchetype {
    readonly type: ASLModuleId[];
    readonly typeId: ASLArchetypeId;

    /** 
     * Map of archetypes that stem of this one. 
     * As a module imports another, it traverses the add map to find the archetype it belongs to.
     */
    readonly addMap = new Map<ASLModuleId, ASLArchetype>();

    /**
     * Map of archetypes that stem of this one.
     * As a module is removed, traverses backwards to find previous archetype.
     */
    readonly removeMap = new Map<ASLModuleId, ASLArchetype>();

    /**
     * @param type Expected to be sorted in ascending order
     * @param typeId string join of type separated by `,` - expected to be in ascending order
     */
    constructor(type: ASLModuleId[], typeId: ASLArchetypeId) {
        this.type = type;
        this.typeId = typeId;
    }
}

/**
 * Pending fetch request made by an environment.
 * Used to track which modules made what requests.
 */
interface ASLRequest {
    promise: CancellablePromise<ASLModuleObject>,

    /** Set of modules that are awaiting the given request */
    requesters: Set<ASLModuleId>
}

/**
 * ASL module unload signal. 
 * Used to indicate when execution was cancelled due to unloading the module rather than an error or other reason.
 */
const ASL_SIGNAL_MODULE_UNLOAD = Symbol("ASL.SIGNAL_MODULE_UNLOAD");

/**
 * Error that happens when execution of a module is cancelled
 */
class ASLExecutionCancelledError extends Error {
    constructor() {
        super("Execution was cancelled.");
        this.name = "ASLExecutionCancelledError";
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ASLExecutionCancelledError);
        }
    }
}

/**
 * Error that occure whilst importing modules
 */
class ASLImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ASLImportError";
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ASLImportError);
        }
    }
}

const defaultImportHook = async (module: ASLModule, path: string) => {
    return path.startsWith(".") ? Path.join(module.dir, path) : path;
};

/**
 * ASL Environment.
 */
export class ASLEnvironment {
    /** Module cache. Maps module to the cached module object. */
    private readonly cache = new Map<ASLModuleId, ASLModuleObject>();

    /** Stores pending fetch requests for modules. */
    private readonly pending = new Map<ASLModuleId, ASLRequest>();

    /** 
     * Archetype tracking for modules.
     * 
     * Per environment as scripts may have environment-based dependencies.
     * Such as the case when modules dynamically import other modules based on user input.
     */
    private readonly rootArchetype = new ASLArchetype([], "");

    /**
     * Archetype associated with each loaded module.
     */
    private readonly moduleArchetype = new Map<ASLModuleId, ASLArchetype>();

    /**
     * Map of all archetypes managed by the environment
     */
    private readonly archetypes = new Map<ASLArchetypeId, ASLArchetype>();

    /**
     * Maps a module id to all archetypes that contain said type
     */
    private readonly typemap = new Map<ASLModuleId, ASLArchetype[]>();

    /**
     * Import hook that the user can define to transform paths before they are used
     */
    public importHook: (module: ASLModule, path: string) => Promise<string> = defaultImportHook;

    constructor() {
        // Register root archetype
        this.archetypes.set(this.rootArchetype.typeId, this.rootArchetype);
    }

    /**
     * Traverses internal archetype graph to return the next archetype when the given module id is added.
     * Creates a new archetype if it did not already exist in the graph.
     * 
     * @param from Current archetype
     * @param mid Module id being added to the current archetype
     * @returns Archetype after adding the given module
     */
    private traverse(from: ASLArchetype, mid: ASLModuleId) {
        // Check add map if we have cached the traversal path
        let arch = from.addMap.get(mid);
        if (arch !== undefined) {
            return arch;
        }

        let insertLocation = 0;
        let high = from.type.length;

        while (insertLocation < high) {
            const middle = (insertLocation + high) >>> 1;
            if (from.type[middle] < mid) {
                insertLocation = middle + 1;
            } else {
                high = middle;
            }
        }

        // Module already exists in our archetype
        if (from.type[insertLocation] === mid) return from;

        // Create a new archetype that contains this module
        const newType = [...from.type];
        newType.splice(insertLocation, 0, mid);

        const newTypeId = newType.join(",");

        // Try and get archetype from cache
        arch = this.archetypes.get(newTypeId);
        if (arch === undefined) {
            // Create archetype, cache it
            arch = new ASLArchetype(newType, newTypeId);
            this.archetypes.set(newTypeId, arch);
        }

        // register to typemap
        let archList = this.typemap.get(mid);
        if (archList === undefined) {
            archList = [];
            this.typemap.set(mid, archList);
        }
        archList.push(arch);

        // update to traversal cache
        from.addMap.set(mid, arch);
        arch.removeMap.set(mid, from);

        return arch;
    }

    /**
     * Import function used by executing modules when they are executed to import other modules into
     * the given environment.
     * 
     * @param promise The execution promise for the module (used to detect cancellation)
     * @param path File path to module
     * @param options Import options
     */
    private import(promise: CancellablePromise<ASLModuleObject>, module: ASLModule, path: string, options?: ASLImportOptions): Promise<ASLModuleObject> {
        // Pass path through import hook
        return this.importHook(module, path).then(path => {
            if (promise.isCancelled) throw new ASLExecutionCancelledError();

            // Create default options
            const parsedOptions: ASLImportOptions = {
            };

            // Parse provided options
            if (options !== undefined) {
                for (const key in options) {
                    const k = key as keyof ASLImportOptions;
                    parsedOptions[k] = options[k];
                }
            }

            // Resolve type of import
            const importType = extname(path);

            switch (importType) {
            case ".node": {
            // Node import

                // eslint-disable-next-line @typescript-eslint/no-require-imports
                return new Promise((resolve) => resolve(require(path)));
            }
            case ".cjs": {
            // Node import

                // eslint-disable-next-line @typescript-eslint/no-require-imports
                return new Promise((resolve) => resolve(require(path)));
            }
            case ".mjs": {
            // ESM import

                return import(path);
            }
            case ".js": {
            // ASL import

                const mid = registry.getMid(path);

                if (mid === module.mid) throw new ASLImportError("Cannot import self.");

                // Update modules archetype as approapriate
                const arch = this.moduleArchetype.get(module.mid);
                if (arch === undefined) {
                    // Arch should always be available - if not, then this module was unloaded and
                    // execution was cancelled.
                    throw new ASLExecutionCancelledError();
                }
                this.moduleArchetype.set(module.mid, this.traverse(arch, mid));

                return this.fetch(mid, module.mid).promise;
            }
            }

            throw new ASLImportError(`Import type is derived from file extension, please use a valid extension: ".cjs", ".mjs", ".js"`);
        });
    }

    /**
     * Auxilary method for `unload`
     * 
     * @param mid Module to unload
     * @param unloadedModules set of modules that were unloaded
     */
    private _unload(mid: ASLModuleId, unloadedModules: Set<ASLModuleId>) {
        // If module is pending, cancel it
        const request = this.pending.get(mid);
        if (request !== undefined) {
            // Pass `ASL_SIGNAL_MODULE_UNLOAD` so that cancel logic knows that 
            // ASL has handled everything already synchronously and the async task should not
            // handle it.
            //
            // Refer to `this.fetch`
            request.promise.cancel(ASL_SIGNAL_MODULE_UNLOAD);

            // We have to handle removal from pending dict synchronously to prevent stack overflow
            // as the `finally()` call that normally handles this in `this.fetch` won't call until next
            // async micro-task event - which won't occure until after this synchronous function 
            // executes.
            this.pending.delete(mid);
        } else if (!this.cache.delete(mid)) {
            // Otherwise, if it is in cache, delete it. If it is not in the cache, 
            // then module was never loaded and we can early return
            return;
        }

        // Add to set of unloaded modules
        unloadedModules.add(mid);

        // Unload modules that depend on this one
        const archetypesContainingModule = this.typemap.get(mid);
        if (archetypesContainingModule === undefined) return;

        for (const archetype of archetypesContainingModule) {
            for (const module of archetype.type) {
                this._unload(module, unloadedModules);
            }
        }

        // Remove module from dependency in registry
        const dependencies: Map<ASLModuleId, Set<ASLEnvironment>> = (registry as any).dependencies;
        dependencies.get(mid)?.delete(this);

        // Remove module from archetype book keeping
        this.moduleArchetype.delete(mid);
        this.typemap.delete(mid);

        // Detach from archetype graph cache (addMap, removeMap)
        for (const archetype of archetypesContainingModule) {
            archetype.removeMap.get(mid)!.addMap.delete(mid);
        }
    }

    /**
     * Unloads the given module and all modules that depend on it
     * 
     * @param path Module to invalidate
     * @returns Set of modules that were unloaded
     */
    public unload(paths: string[]): Set<ASLModuleId>
   
    /**
     * Unloads the given module and all modules that depend on it
     * 
     * @param mid Module to invalidate
     * @returns Set of modules that were unloaded
     */
    public unload(mids: ASLModuleId[]): Set<ASLModuleId>
    
    public unload(list: (string | ASLModuleId)[]): Set<ASLModuleId> {
        // Resolve mids
        const mids = list.map(mid => {
            if (typeof mid === "string") {
                mid = registry.getMid(mid);
            }
            return mid;
        });

        const unloadedModules = new Set<ASLModuleId>();
        for (const mid of mids) {
            this._unload(mid, unloadedModules);
        }
        return unloadedModules;
    }

    /**
     * Invalidates the given module, causing it to reload. 
     * Subsequently reloads modules that depend on it.
     * 
     * @param path Module to invalidate
     */
    public invalidate(paths: string[]): void

    /**
     * Invalidates the given module, causing it to reload. 
     * Subsequently reloads modules that depend on it.
     * 
     * @param mid Module to invalidate
     */
    public invalidate(mids: ASLModuleId[]): void

    public invalidate(list: (ASLModuleId | string)[]) {
        // Resolve mids
        const mids = list.map(mid => {
            if (typeof mid === "string") {
                mid = registry.getMid(mid);
            }
            return mid;
        });

        const promises = [];
        for (const module of this.unload(mids)) {
            promises.push(this.fetch(module));
        }
    }

    /**
     * Loads a module into the environment
     * 
     * @param mid module id
     * @param requester the module making the request - used for debugging
     */
    public fetch(mid: ASLModuleId, requester?: ASLModuleId): CancellablePromise<ASLModuleObject>

    /**
     * Loads a module into the environment
     * 
     * @param path File path to module
     * @param requester the module making the request - used for debugging
     */
    public fetch(path: string, requester?: ASLModuleId): CancellablePromise<ASLModuleObject>

    public fetch(mid: string | ASLModuleId, requester?: ASLModuleId) {
        // Resolve mid from path
        if (typeof mid === "string") {
            mid = registry.getMid(mid);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let request = this.pending.get(mid);

        if (request === undefined) {
            // If module is not pending, create the request

            const promise = new CancellablePromise<ASLModuleObject>((resolve, reject, self) => {
                // Try get module from cache
                if (this.cache.has(mid)) {
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    registry.fetch(mid, this)
                        .then(info => {
                            // Assign archetype
                            this.moduleArchetype.set(mid, this.traverse(this.rootArchetype, mid));

                            // Execute module
                            return info.exec(this.import.bind(this, self));
                        })
                        .then((obj) => {
                            // Store module object into cache
                            this.cache.set(mid, obj);

                            // Resolve promise
                            resolve(obj);
                        })
                        .catch(reject);
                }
            });

            // Add to map of pending requests
            request = {
                promise,
                requesters: new Set()
            };
            this.pending.set(mid, request);

            // When request finishes, remove from pending
            promise.catch(noop).finally(() => {
                // On unload signal, skip handling as it is already handled automatically by ASL synchronously
                // by the `unload` method.
                // 
                // This is because we cannot trust order of execution by JS engine's micro-tasks.
                // Pending needs to be deleted on cancel, before we re-request execution of the modules,
                // but this is not guaranteed if we rely on JS micro-task scheduling.
                if (promise.cancelReason === ASL_SIGNAL_MODULE_UNLOAD) return;
                
                this.pending.delete(mid);
            });
        }

        // Keep track of the requester
        if (requester !== undefined) request.requesters.add(requester);

        return request.promise;
    }
}