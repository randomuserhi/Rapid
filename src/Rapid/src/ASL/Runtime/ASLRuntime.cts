/**
 * Async Script Loader
 * 
 * @randomuserhi 2025
 */

import File from "fs/promises";
import Path from "path";

/**
 * A promise wrapper for promises that can be cancelled.
 */
class CancellablePromise<T> {
    readonly promise: Promise<T>;
    readonly cancel: (reason?: any) => void;

    constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void) {
        this.cancel = undefined!;
        this.promise = new Promise((resolve, reject) => {
            (this as any).cancel = reject;
            executor(resolve, reject);
        });
        if (this.cancel === undefined) throw new Error("Could not generate cancel function.");
    }

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    public then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
        return this.promise.then(onfulfilled, onrejected);
    }

    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    public catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult> {
        return this.promise.catch(onrejected);
    }

    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    public finally(onfinally?: (() => void) | undefined | null): Promise<T> {
        return this.promise.finally(onfinally);
    }
}

/**
 * Module object, represents exports for a module.
 */
type ASLModuleObject = Record<PropertyKey, any>;

/**
 * ASL module function.
 * 
 * @param aslImport ASL import function. Used to import other modules.
 * @param module Object containing module information.
 * @param exports Object containing the modules exports.
 */
type ASLModuleFunc = (aslImport: any, module: any, exports: ASLModuleObject) => Promise<void>;

interface ASLModule {
    /**
     * Executes the given module, returning the module object containing its exports.
     */
    exec: () => Promise<ASLModuleObject>;
}

/**
 * Stores a cache of loaded modules.
 * 
 * Manages cache invalidation as well as hot reloading.
 */
class ASLRegistry {
    /** Module cache. Maps module file path to the cached module info. */
    private cache = new Map<string, ASLModule>();

    /** Stores pending fetch requests for modules. */
    private pending = new Map<string, CancellablePromise<ASLModule>>();

    /** 
     * Dependency map of module to ASL environment.
     * 
     * When a given module is hot reloaded, we know which environments are effected.
     */
    private dependencies = new Map<string, Set<ASLEnvironment>>();

    /**
     * Loads a module into cache.
     * 
     * @param path File path to module
     * @param env Environment that is fetching the module - used internally for book keeping dependencies for hot reloading
     * @returns The loaded module information
     */
    public fetch(path: string, env?: ASLEnvironment): CancellablePromise<ASLModule> {
        // Normalize the path as we use path to index modules
        path = Path.normalize(path);

        // Add dependency
        if (env !== undefined) {
            let dependencySet = this.dependencies.get(path);
            if (dependencySet === undefined) {
                dependencySet = new Set();
                this.dependencies.set(path, dependencySet);
            }
            dependencySet.add(env);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let promise = this.pending.get(path);

        if (promise === undefined) {
            // If module is not pending, create the request

            promise = new CancellablePromise<ASLModule>((resolve, reject) => {
                // Try get module from cache
                if (this.cache.has(path)) {
                    resolve(this.cache.get(path)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    File.readFile(path, { encoding: "utf-8" })
                        .then(code => {
                            // Create module function.
                            // This runs in an async function as it ASL needs to support the `await` keyword.
                            // The function has the parameters `aslImport`, `module` and `exports` to provide the necessary keywords.
                            const moduleFunc = (new Function(`return (async function(aslImport, module, exports) {\n${code}\n}).bind(undefined); //# sourceURL=${path}`))() as ASLModuleFunc;

                            // Create module info
                            const moduleInfo = {
                                exec: execModule.bind(undefined, moduleFunc) as ASLModule["exec"]
                            };

                            // Add to cache
                            this.cache.set(path, moduleInfo);

                            // Resolve request
                            resolve(moduleInfo);
                        })
                        .catch(e => reject(e));
                }
            });
        
            // Add to map of pending requests
            this.pending.set(path, promise);

            // When request finishes, remove from pending
            promise.finally(() => this.pending.delete(path));
        }

        return promise;
    }
}

/**
 * The global registry of loaded modules.
 * 
 * Keeps track of which environments depend on which modules for hot reloading.
 */
export const registry = new ASLRegistry();

/**
 * Executes the given module, providing the necessary parameters.
 * 
 * @param moduleFunc The ASLModuleFunc of the module being executed.
 */
async function execModule(moduleFunc: ASLModuleFunc): Promise<ASLModuleObject> {
    await moduleFunc({}, {}, {});
    return {};
}

/**
 * ASL Environment.
 * 
 * TODO(randomuserhi): documentation
 */
export class ASLEnvironment {
    /** Module cache. Maps module file path to the cached module object. */
    private cache = new Map<string, ASLModuleObject>();

    /** Stores pending fetch requests for modules. */
    private pending = new Map<string, CancellablePromise<ASLModuleObject>>();

    /**
     * Loads a module into the environment
     * 
     * @param path File path to module
     */
    public fetch(path: string): CancellablePromise<ASLModuleObject> {
        // Normalize the path as we use path to index modules
        path = Path.normalize(path);

        // Get pending request if module has been loaded before but is still waiting.
        let promise = this.pending.get(path);

        if (promise === undefined) {
            // If module is not pending, create the request

            promise = new CancellablePromise<ASLModuleObject>((resolve, reject) => {
                // Try get module from cache
                if (this.cache.has(path)) {
                    resolve(this.cache.get(path)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    registry.fetch(path, this)
                        .then(info => info.exec())
                        .then((obj) => {
                            this.cache.set(path, obj);
                            resolve(obj);
                        })
                        .catch(e => reject(e));
                }
            });

            // Add to map of pending requests
            this.pending.set(path, promise);

            // When request finishes, remove from pending
            promise.finally(() => this.pending.delete(path));
        }

        return promise;
    }
}