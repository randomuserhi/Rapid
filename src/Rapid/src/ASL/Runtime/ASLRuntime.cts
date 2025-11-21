/**
 * Async Script Loader
 * 
 * @randomuserhi 2025
 */

// TODO(randomuserhi): Improved documentation with more detail

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

/** Module ID type */
type ASLModuleId = number;

/** Function that imports another module from an ASL module execution context. */
type ASLEnvImportFunc = (module: ASLModule, path: string, options?: any) => Promise<ASLModuleObject>;

/** Function that imports another module from an ASL module execution context. */
type ASLImportFunc = (path: string, options?: any) => Promise<ASLModuleObject>;

/**
 * ASL module function.
 * 
 * @param aslImport ASL import function. Used to import other modules.
 * @param module Object containing module information.
 * @param exports Object containing the modules exports.
 */
type ASLModuleFunc = (aslImport: ASLImportFunc, module: any, exports: ASLModuleObject) => Promise<void>;

/**
 * ASLModule information.
 * 
 * Contains information about the module, such as its archetype and execution function.
 */
class ASLModule {
    /** Module path (normalized) */
    readonly path: string;

    /** Module id */
    readonly mid: ASLModuleId;

    /**
     * Executes the given module, returning the module object containing its exports.
     */
    readonly exec: (aslImport: any) => Promise<ASLModuleObject> = undefined!;

    constructor(mid: ASLModuleId, path: string) {
        this.path = path;
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
                            // The function has the parameters `aslImport`, `module` and `exports` to provide the necessary keywords.
                            const moduleFunc = (new Function(`return (async function(aslImport, module, exports) {\n${code}\n}).bind(undefined); //# sourceURL=${path}`))() as ASLModuleFunc;

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
            promise.finally(() => this.pending.delete(mid));
        }

        return promise;
    }

    /**
     * Executes the given module, providing the necessary parameters.
     * 
     * @param moduleFunc The ASLModuleFunc of the module being executed.
     */
    private async execModule(module: ASLModule, moduleFunc: ASLModuleFunc, envImport: ASLEnvImportFunc): Promise<ASLModuleObject> {
        // TODO(randomuserhi): Finish implementation
        await moduleFunc(envImport.bind(undefined, module), {}, {});
        return {};
    }

    /**
     * Invalidates a module, causing it to reload any of its dependencies.
     * Affects all environments that include the invalidated module.
     * 
     * @param path Module to mark as invalidated
     */
    public async invalidate(path: string): Promise<void> {
        const mid = this.getMid(path);
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

    private constructor(type: ASLModuleId[], typeId: ASLArchetypeId) {
        this.type = type;
        this.typeId = typeId;
    }

    public static createArchetype(type: ASLModuleId[] = []) {
        type = [...type.sort()];
        return new ASLArchetype(type.sort(), type.join(","));
    }

    /**
     * Traverses the achetype map to return the new archetype when the given module id is added.
     * Creates a new archetype if it did not already exist in the provided cache.
     * 
     * TODO(randomuserhi): Move into ASLEnvironment class, so that we do not have to pass the cache as a parameter?
     *                     Also ensures that archetypes do not cross-contaminate as `addMap` must contain only
     *                     archetypes that can be found within the provided `cache`.
     * 
     * @param mid Module id being added to the current archetype
     * @param cache Cache of existing archetypes
     * @returns Archetype after adding the given module
     */
    public traverse(mid: ASLModuleId, cache: Map<ASLArchetypeId, ASLArchetype>): ASLArchetype {
        // Check add map if we have cached the traversal path
        let arch = this.addMap.get(mid);
        if (arch !== undefined) {
            return arch;
        }

        let insertLocation = 0;
        let high = this.type.length;

        while (insertLocation < high) {
            let middle = (insertLocation + high) >>> 1;
            if (this.type[middle] < mid) {
                insertLocation = middle + 1;
            } else {
                high = middle;
            }
        }

        // Module already exists in our archetype
        if (this.type[insertLocation] === mid) return this;

        // Create a new archetype that contains this module
        let newType = [...this.type];
        newType.splice(insertLocation, 0, mid);

        const newTypeId = newType.join(",");

        // Try and get archetype from cache
        arch = cache.get(newTypeId);
        if (arch === undefined) {
            arch = new ASLArchetype(newType, newTypeId);
            cache.set(newTypeId, arch);
        }

        // Add to traversal cache (addMap)
        this.addMap.set(mid, arch);

        return arch;
    }
}

/**
 * ASL Environment.
 * 
 * TODO(randomuserhi): documentation
 */
export class ASLEnvironment {
    /** Module cache. Maps module file path to the cached module object. */
    private readonly cache = new Map<ASLModuleId, ASLModuleObject>();

    /** Stores pending fetch requests for modules. */
    private readonly pending = new Map<ASLModuleId, CancellablePromise<ASLModuleObject>>();

    /** Cached import function pre-bound to the given environment. */
    private readonly aslImport: ASLEnvImportFunc = this.import.bind(this);

    /** 
     * Archetype tracking for modules.
     * 
     * Per environment as scripts may have environment-based dependencies.
     * Such as the case when modules dynamically import other modules based on user input.
     */
    private readonly rootArchetype = ASLArchetype.createArchetype();

    /**
     * Archetype associated with each loaded module.
     */
    private readonly moduleArchetype = new Map<ASLModuleId, ASLArchetype>();

    /**
     * Map of all archetypes managed by the environment
     */
    private readonly archetypes = new Map<ASLArchetypeId, ASLArchetype>();

    constructor() {
        this.archetypes.set(this.rootArchetype.typeId, this.rootArchetype);
    }

    // TODO(randomuserhi): Debug function, probably remove at somepoint
    public getArchetype(mid?: ASLModuleId) {
        if (mid === undefined) return this.rootArchetype;
        return this.moduleArchetype.get(mid);
    }

    /**
     * Import function used by executing modules when they are executed to import other modules into
     * the given environment.
     * 
     * @param path File path to module
     * @param options Import options
     */
    private async import(module: ASLModule, path: string, options?: any) {
        // TODO(randomuserhi): Resolve relative paths ...

        const mid = registry.getMid(path);

        // TODO(randomuserhi): Standardize error message
        if (mid === module.mid) throw new Error("Cannot import self.");

        // Update modules archetype as approapriate
        const arch = this.moduleArchetype.get(module.mid)!;
        this.moduleArchetype.set(module.mid, arch.traverse(mid, this.archetypes));

        return await (this.fetch(mid).promise);
    }

    /**
     * Initializes internal book keeping for the given module
     * 
     * @param mid Module id
     */
    private initModule(mid: ASLModuleId) {
        // Assign default module archetype
        this.moduleArchetype.set(mid, this.rootArchetype);
    }

    /**
     * Clears internal book keeping for the given module
     * 
     * @param mid Module id
     */
    private destructModule(mid: ASLModuleId) {
        // Remove module archetype
        this.moduleArchetype.delete(mid);
    }

    /**
     * Loads a module into the environment
     * 
     * @param mid module id
     */
    public fetch(mid: number): CancellablePromise<ASLModuleObject>

    /**
     * Loads a module into the environment
     * 
     * @param path File path to module
     */
    public fetch(path: string): CancellablePromise<ASLModuleObject>

    public fetch(mid: string | number) {
        // Resolve mid from path
        if (typeof mid === "string") {
            mid = registry.getMid(mid);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let promise = this.pending.get(mid);

        if (promise === undefined) {
            // If module is not pending, create the request

            promise = new CancellablePromise<ASLModuleObject>((resolve, reject) => {
                // Try get module from cache
                if (this.cache.has(mid)) {
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    registry.fetch(mid, this)
                        .then(info => {
                            // Initialize internal module state:
                            this.initModule(mid);

                            // Execute module
                            return info.exec(this.aslImport);
                        })
                        .then((obj) => {
                            // Store module object into cache
                            this.cache.set(mid, obj);

                            // Resolve promise
                            resolve(obj);
                        })
                        .catch(e => {
                            // Cleanup module resources
                            this.destructModule(mid);

                            reject(e);
                        });
                }
            });

            // Add to map of pending requests
            this.pending.set(mid, promise);

            // When request finishes, remove from pending
            promise.finally(() => this.pending.delete(mid));
        }

        return promise;
    }
}