/**
 * Async Script Loader
 * 
 * @randomuserhi 2025
 */

import Path from "path"
import File from "fs/promises"

/**
 * Module object, represents exports for a module.
 */
type ASLModuleObject = Record<PropertyKey, any>;

/**
 * ASL module function.
 * 
 * @param asl ASL import function. Used to import other modules.
 * @param module Object containing module information.
 * @param exports Object containing the modules exports.
 */
type ASLModuleFunc = (asl: any, module: any, exports: ASLModuleObject) => Promise<void>;

interface ASLModule {
    /**
     * Executes the given module, returning the module object containing its exports.
     */
    exec: () => Promise<ASLModuleObject>;
}

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
 * Stores a cache of loaded modules.
 * Manages cache invalidation as well as hot reloading.
 */
class ASLRegistry {
    /** Module cache. Maps module file path to the cached module info. */
    private cache = new Map<string, ASLModule>();

    /**
     * Loads a module into cache.
     * 
     * @param path File path to module
     * @returns The loaded module information
     */
    public async fetch(path: string): Promise<ASLModule> {
        // Normalize the path as we use path to index modules
        path = Path.normalize(path);

        // Try get module from cache
        let moduleInfo = this.cache.get(path);

        // If its not in cache, fetch it
        if (moduleInfo === undefined) {
            // Read the code from module file
            const code = await File.readFile(path, { encoding: "utf-8" });

            // Create module function.
            // This runs in an async function as it ASL needs to support the `await` keyword.
            // The function has the parameters `asl`, `module` and `exports` to provide the necessary keywords.
            const moduleFunc = (new Function(`return (async function(asl, module, exports) {\n${code}\n}).bind(undefined); //# sourceURL=${path}`))() as ASLModuleFunc;

            // Create module info
            moduleInfo = {
                exec: execModule.bind(undefined, moduleFunc) as ASLModule["exec"]
            };

            // Add to cache
            this.cache.set(path, moduleInfo);
        }

        return moduleInfo;
    }
}

const registry = new ASLRegistry();

export class ASLEnvironment {
    /** 
     * Module cache. Maps module file path to the cached module object. 
     * 
     * Stored as a promise as the module might still be loading.
     * This way on fetch, if we have a pending fetch into cache, it will just await the pending fetch
     * instead of fetching again.
     */
    private cache = new Map<string, Promise<ASLModuleObject>>();

    /**
     * Loads a module into the environment
     * 
     * @param path File path to module
     */
    public async fetch(path: string): Promise<ASLModuleObject> {
        // Normalize the path as we use path to index modules
        path = Path.normalize(path);

        // Get module object from cache
        let moduleObjectPromise = this.cache.get(path);

        // If it is not cached, fetch and execute it
        if (moduleObjectPromise === undefined) {
            moduleObjectPromise = registry.fetch(path).then(info => info.exec());
            this.cache.set(path, moduleObjectPromise);
        }

        return await moduleObjectPromise;
    }
}