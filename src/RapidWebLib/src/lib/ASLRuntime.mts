/**
 * Async Script Loader (Node version)
 * 
 * @randomuserhi 2025
 */

//
// CONFIGURATION
//

interface ASLConfig {
    isCaseSensitive: boolean;
    baseURL: URL | undefined;
}

export const ASL_CONFIG: ASLConfig = {
    isCaseSensitive: true,
    baseURL: undefined
};

//
// STATIC CONFIGURATION
//

export const ASL_EXTENSION = ".asl";
export const ASL_EXTENSION_TS = `${ASL_EXTENSION}.ts`;
export const ASL_EXTENSION_JS = `${ASL_EXTENSION}.js`;
export const ASL_EXTENSION_JS_MAP = `${ASL_EXTENSION}.js.map`;

export const ASL_EXPORTS_KEYWORD = "__ASL_exports";
export const ASL_REQUIRE_KEYWORD = "__ASL_require";

/** link hook function type. */
export type __linkASLRuntime = (runtime: ASLModuleRuntime, exports: ASLExports) => ASLExports;

export const ASL_RUNTIME_HOOK_NAME = "__linkASLRuntime";

export const ASL_STATUS_CODES = {
    OK: Symbol("ASL.OK")
} as const;

/** Function called on import */
export type ASLImportHook = (module: ASLModuleInfo, path: string, options?: ASLImportOptions) => Promise<string | ASLExports>;

/** By default, resolve relative paths based on importing module */
export const defaultImportHook = async (module: ASLModuleInfo, path: string) => {
    return new URL(path, path.startsWith(".") ? module.path : ASL_CONFIG.baseURL).toString();
};

/** Function called on error */
export type ASLErrorHook = (mid: ASLModuleId, error?: any) => void;

/** By default, console log error */
export const defaultErrorHook = (mid: ASLModuleId, error?: any) => {
    console.error(`${registry.getPath(mid)}:`, error);
};

//
// PATH OPERATIONS
//

const CHAR_FORWARD_SLASH = 47; /* / */
const CHAR_BACKWARD_SLASH = 92; /* \ */
const CHAR_DOT = 46; /* . */

function isPathSeparator(code: number) {
    return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

/**
 * Obtain the location of the extension name for a path
 * 
 * @param path Path
 * @returns File extension
 */
function findExtname(path: string): { start: number, end: number } | undefined {
    if (typeof path !== "string") {
        throw new TypeError(`The "path" argument must be of type string. Received type ${typeof path}`);
    }
    let start = -1;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;
    for (let i = path.length - 1; i >= 0; --i) {
        const code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
                break;
            }

            // Ignore the first path separator if its at the end of the string
            // e.g "a.b/" will still give the extension ".b"
            continue;
        }
        if (end === -1) {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matchedSlash = false;
            end = i + 1;
        }
        if (code === CHAR_DOT) {
            // Check we did not see 2 dots in a row and that there
            // are characters prior the first dot
            if (preDotState !== 0 && start !== i + 1) {
                start = i;
            } else {
                break;
            }
        } else if (start === -1) {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            preDotState = -1;
        }
    }
    if (start === -1 ||
        end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0) {
        return undefined;
    }
    return {
        start,
        end
    };
}

/**
 * Obtain extension name from path
 * 
 * @param path Path
 * @returns File extension
 */
function extname(path: string) {
    const location = findExtname(path);
    if (location === undefined) return "";
    return path.slice(location.start, location.end);
}

/** Fixes file paths that end in ".asl" to ".asl.js" for convenience */
function fixASLExt(path: string): string {
    const location = findExtname(path);
    if (location === undefined) return path;

    if (path.slice(location.start, location.end) !== ".asl") return path;
    return `${path.slice(0, location.start)}${ASL_EXTENSION_JS}${path.slice(location.end)}`;
}

/** Find first item from an import path */
function findFirst(path: string): { start: number, end: number } | undefined {
    let start = -1;
    let end = 0;
    let validCharacters = false;
    let separatorCount = 0;
    for (; end < path.length; ++end) {
        const code = path.charCodeAt(end);
        if (code !== CHAR_FORWARD_SLASH) {
            if (!validCharacters) start = end;
            validCharacters = true;
        } else if (validCharacters || ++separatorCount > 1) {
            break;
        }
    }
    if (start === -1) return undefined;
    return { start, end };
}

/** Gets the first item of an import path */
function first(path: string): string {
    const location = findFirst(path);
    if (location === undefined) return "";
    return path.slice(location.start, location.end);
}

function endsWithSeparator(path: string): boolean {
    const code = path.charCodeAt(path.length - 1);
    return isPathSeparator(code);
}

function startsWithSeparator(path: string): boolean {
    if (path.length === 0) return false;
    const code = path.charCodeAt(0);
    return isPathSeparator(code);
}

export const ASLPath = {
    first,
    extname,
    fixASLExt,
    findExtname,
    findFirst,
    endsWithSeparator,
    startsWithSeparator
};

//
// HELPERS
//

/**
 * Stores a reference to a value.
 * Errors when reference is set to `Ref.NULLPTR`
 */
class Ref<T> {
    public static NULLPTR = Symbol("Ref.NULLPTR");

    private item: T | typeof Ref<T>["NULLPTR"];

    constructor(item: Ref<T>["item"] = Ref.NULLPTR) {
        this.item = item;
    }

    public deref(): T {
        if (this.isNull()) throw new ReferenceError("Cannot deref 'Ref.NULLPTR'");
        return this.item as T;
    }

    public set(value: Ref<T>["item"]) {
        this.item = value;
    }

    public isNull(): boolean {
        return this.item === Ref.NULLPTR;
    }
}

/**
 * Describes a cancellable job
 */
interface ASLJob<Context, Result> {
    /**
     * Job context
     * 
     * If null, the job is no longer valid and its result should be discarded
     */
    contextRef: Ref<Context>;

    /**
     * The actual job
     */
    job: Promise<Result>;

    /**
     * Cancel this job
     * 
     * @param reason Reason for cancellation
     */
    cancel(reason?: any): void;
}

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
function bind<A extends any[], B extends any[], R>(func: (...args: [...A, ...B]) => R, ...args: A): (...args: B) => R {
    return (...remaining: B) => func(...args, ...remaining);
}

///
/// ASLRegistry
///

/** Module ID type */
export type ASLModuleId = number;

/**
 * Module object, represents exports for a module.
 */
export type ASLExports = any;

/**
 * Information about a given module
 */
export interface ASLModuleInfo {
    /** Module path (normalized) */
    readonly path: string;

    /** Module id */
    readonly mid: ASLModuleId;
}

/**
 * Compiled module
 */
class ASLCompiledModule {
    /**
     * Information about this module
     */
    readonly info: ASLModuleInfo;
    
    /**
     * Executes the module with the given runtime
     */
    readonly exec: (runtime: ASLModuleRuntime) => Promise<ASLExecutionResult> = undefined!;
    
    constructor(mid: ASLModuleId, path: string) {
        this.info = {
            path,
            mid
        };
    }
}

/**
 * ASL module fetch result
 */
class ASLCompilationResult {
    readonly error: any;
    readonly module: ASLCompiledModule;

    constructor(module?: ASLCompiledModule, error: any = ASL_STATUS_CODES.OK) {
        this.module = module!;
        this.error = error;
    }

    public ok() {
        return this.error === ASL_STATUS_CODES.OK;
    }
}

/** 
 * ASL Compilation job
 */
interface ASLCompilationJob extends ASLJob<ASLRegistry, ASLCompilationResult> {
    /**
     * The module being compiled
     */
    mid: ASLModuleId;
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
        path = new URL(path, ASL_CONFIG.baseURL).toString();

        if (!ASL_CONFIG.isCaseSensitive) path = path.toLowerCase();

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
    private readonly cache = new Map<ASLModuleId, ASLCompilationResult>();

    /** Stores pending fetch requests for modules. */
    private readonly pending = new Map<ASLModuleId, ASLCompilationJob>();

    /** 
     * Dependency map of module to ASL environment.
     * 
     * When a given module is hot reloaded, we know which environments are affected.
     */
    private readonly dependencies = new Map<ASLModuleId, Set<ASLEnvironment>>();

    /**
     * Cancels a compilation of a module.
     * 
     * @param resolve `resolve` function used to settle the request promise
     */
    private static cancel(resolve: (result: ASLCompilationResult) => void) {
        // Reject request promise
        resolve(new ASLCompilationResult(undefined, new ASLCompilationCancelledError()));
    }

    /**
     * Compiles a module, the result is cached internally to prevent rebuilding constantly.
     * 
     * @param mid Module id to compile
     * @param env Environment that is fetching the module - used internally for book keeping dependencies for hot reloading
     * @returns Compilation result
     */
    public compile(mid: ASLModuleId, env?: ASLEnvironment): Promise<ASLCompilationResult> {
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
        let compilation = this.pending.get(mid);

        if (compilation === undefined) {
            // If module is not pending, create the compilation job

            const _compilation: ASLCompilationJob = {
                mid,
                contextRef: new Ref(this),
                job: undefined!,
                cancel: undefined!
            };
            _compilation.job = new Promise((resolve) => {
                _compilation.cancel = bind(ASLRegistry.cancel, resolve);

                // Try get module from cache
                if (this.cache.has(mid)) {
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    fetch(path, { method: "GET" }).then((req) => {
                        if (req.ok) {
                            return req.text();
                        } else {
                            // TODO(randomuserhi): Better error message
                            throw new Error(`Unable to fetch ASL module: ${req.statusText} (${req.status})`);
                        }
                    }).then(code => {
                        // Get request context
                        const context = _compilation.contextRef.deref();

                        // Create module function.
                        // This runs in an async function as ASL needs to support the `await` keyword at the top-level.
                        // The function has the parameters `require`, `module` and `exports` to provide the necessary keywords.
                        //
                        // Note that `require` refers to `aslImport`, in ASL scripts the keyword is `require` for simplicity
                        const entryPoint = (new Function(`return (async (${ASL_REQUIRE_KEYWORD}, __ASL, ${ASL_EXPORTS_KEYWORD}) => {\n${code}\n});\n//# sourceURL=${path}\n//# sourceMappingURL=${path}.map`))() as ASLEntryPoint;

                        // Create module info
                        const compiledModule = new ASLCompiledModule(mid, path);
                        (compiledModule as any).exec = bind(ASLExec, compiledModule.info, entryPoint);

                        // Add to cache
                        const result = new ASLCompilationResult(compiledModule);
                        context.cache.set(mid, result);

                        // Resolve request
                        resolve(result);
                    }).catch((error) => {
                        const result = new ASLCompilationResult(undefined, error);

                        if (!_compilation.contextRef.isNull()) {
                            // Cache result if request has not been cancelled yet
                            const context = _compilation.contextRef.deref();
                            context.cache.set(mid, result);
                        }

                        // Resolve error result
                        resolve(result);
                    });
                }
            });

            // Add to map of pending requests
            compilation = _compilation;
            this.pending.set(mid, compilation);

            // When request successfully finishes, remove from pending
            _compilation.job.then(() => {
                // Check if request is still bound to request context,
                // If not then the module must have been detached (unloaded from registry)
                // and thus should not do anything.
                if (_compilation.contextRef.isNull()) return;

                const context = _compilation.contextRef.deref();
                context.cleanupPendingCompilation(_compilation);
            });
        }

        return compilation.job;
    }

    /**
     * Cleanup pending compilation
     * 
     * @param mid Module id
     */
    private cleanupPendingCompilation(compilation: ASLCompilationJob) {
        // Unbind compilation
        compilation.contextRef.set(Ref.NULLPTR);

        // Remove from pending
        if (!this.pending.delete(compilation.mid)) throw new Error("Could not find pending compilation job.");
    }

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param path Module to mark as invalidated
     */
    public invalidate(paths: string[]): Promise<ASLExecutionResult[][]>;

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param mid Module to mark as invalidated
     */
    public invalidate(mids: ASLModuleId[]): Promise<ASLExecutionResult[][]>;

    public invalidate(list: (ASLModuleId | string)[]) {
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
            const pending = this.pending.get(mid);
            if (pending !== undefined) {
                // If module is pending, cancel it and clean up the compilation job
                pending.cancel();
                this.cleanupPendingCompilation(pending);
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
        const promises = [];
        for (const [env, envList] of midsMap.entries()) {
            promises.push(env.invalidate(envList));
        }
        return Promise.all(promises);
    }
}

/**
 * The global registry of loaded modules.
 * 
 * Keeps track of which environments depend on which modules for hot reloading.
 */
export const registry = new ASLRegistry();

//
// ASLEnvironment
//

interface ASLImportResult {
    exports: ASLExports;
    error: any;
    runtime?: ASLModuleRuntime;
    ok(): boolean;
}

const ASLImportResultPrototype = {
    ok(this: ASLImportResult) {
        return this.error === ASL_STATUS_CODES.OK;
    }
};

/** 
 * Create an ASLImportResult object 
 * 
 * @param _exports Module exports, named `_exports` to prevent conflicting with commonjs `exports` keyword. 
 */
function ASLImportResult(runtime: ASLModuleRuntime | undefined, _exports: ASLExports | undefined, error: any = ASL_STATUS_CODES.OK): ASLImportResult {
    const result: ASLImportResult = Object.create(ASLImportResultPrototype);
    result.runtime = runtime;
    result.error = error;
    Object.defineProperty(result, "exports", {
        get(this: ASLImportResult) {
            if (!this.ok()) {
                // TODO(randomuserhi): Better error message
                throw new Error(`Failed to import module.`);
            }
            return _exports;
        },
        enumerable: true
    });
    return result;
}

/**
 * Import options when using `require` in an ASL script
 */
interface ASLImportOptions {
    /** 
     * Should the import count as a dependency? 
     * If so, then invalidating that import also invalidates this module.
     * 
     * default: true
     */
    updateDependencyGraph: boolean;

    /**
     * Override the interpreted import type
     */
    importType?: ".mjs" | ".js" | ".asl" | ".cjs" | ".node" | typeof ASL_EXTENSION | typeof ASL_EXTENSION_JS;
}

/** Function that imports another module from an ASL module execution context. */
type ASLImportFunc = (path: string, options?: Partial<ASLImportOptions>) => Promise<ASLExports>;

/**
 * ASL module function.
 * 
 * @param __ASL_require ASL import function. Used to import other modules.
 * @param __ASL Object containing asl API.
 * @param __ASL_exports Object containing the modules exports.
 */
type ASLEntryPoint = (__ASL_require: ASLImportFunc, __ASL: any, __ASL_exports: ASLExports) => Promise<void>;

/**
 * Import function used by executing modules when they are executed to import other modules into
 * the given environment.
 * 
 * Note that this method should never throw. It returns a result which has a status code to determine if it completed succesfully
 *
 * @param moduleInfo The information about the module making the import
 * @param runtime The module runtime of the module making the import
 * @param path File path to module being imported
 * @param options Import options
 * @returns Imported module's execution result
 */
function ASLImport(moduleInfo: ASLModuleInfo, runtime: ASLModuleRuntime, path: string, options?: Partial<ASLImportOptions>): Promise<ASLImportResult> {
    // Create default options
    const parsedOptions: ASLImportOptions = {
        updateDependencyGraph: true
    };

    // Parse provided options
    if (options !== undefined) {
        for (const key in options) {
            const k = key as keyof ASLImportOptions;
            if (Object.prototype.hasOwnProperty.call(options, k)) {
                parsedOptions[k] = options[k] as never;
            }
        }
    }

    // Get runtime contextRef
    const contextRef = runtime.__internal.contextRef;

    // If we have been detached, return a failed fetch
    if (contextRef.isNull()) return new Promise((resolve) => resolve(ASLImportResult(undefined, undefined, new ASLImportError("Cannot perform import as our execution has been cancelled."))));

    // Get environment from execution context
    const env = contextRef.deref();

    return env.importHook(moduleInfo, path, parsedOptions).then(async path => {
        // If import hook returned an object directly, use that instead
        if (typeof path !== "string") return new ASLExecutionResult(undefined, path);
        // Resolve type of import
        const importType = parsedOptions.importType ?? extname(path);

        switch (importType) {
        case ASL_EXTENSION:
        case ASL_EXTENSION_JS: {
            // ASL import

            const mid = registry.getMid(path);

            if (mid === moduleInfo.mid) return new ASLExecutionResult(undefined, undefined, new ASLImportError("Cannot import self."));

            // If we have been detached, return a failed fetch
            if (contextRef.isNull()) return new ASLExecutionResult(undefined, undefined, new ASLImportError("Cannot perform import as our execution has been cancelled."));

            // Get environment from execution context
            const env = contextRef.deref();

            if (parsedOptions.updateDependencyGraph) {
                env.updateDependencyGraph(moduleInfo.mid, mid);
            }

            // Can return directly as ASL handles linking runtime automatically
            return env.fetch(mid, runtime);
        }
        case ".js":
        case ".mjs": {
            // ESM import

            const esModule = await import(path);
            
            return new ASLExecutionResult(undefined, esModule);
        }
        case ".node": {
            // Node import
                    
            return new ASLExecutionResult(undefined, undefined, new ASLImportError(`Web based ASL does not support '.node' (native addons) style imports.`));
        }
        case ".cjs": {
            // Node import
                    
            return new ASLExecutionResult(undefined, undefined, new ASLImportError(`Web based ASL does not support '.cjs' style imports.`));
        }
        }

        return new ASLExecutionResult(undefined, undefined, new Error("ASL imports require an extension to distinguish between ASL, MJS or CJS style import."));
    }).then((result) => {
        // Link exports to importer's runtime
        if (result.ok()) return linkExports(runtime, result.exports, result.runtime);

        // Error result
        return ASLImportResult(result.runtime, result.exports, result.error);
    }).catch((error) => {
        // Error result
        return ASLImportResult(undefined, undefined, error);
    });
}

/**
 * A post-processing step that can be performed on any module exports that implements it.
 *
 * Allows exports to link with an ASL module runtime (typically the runtime importing it) 
 * to produce a different set of exports specific to said runtime.
 * 
 * ASL require calls automatically perform this step (unlike `ASLEnvironment.fetch`) which allows
 * modules implementing this to be aware of the importer, providing access to the importer's runtime.
 * It may then return different exports depending on the importer.
 * 
 * @param importer The runtime for the module performing the import
 * @param exports The exports of the imported module
 * @param imported The runtime of the imported module (if the exports originate from an ASLModule)
 * @returns linked exports
 */
async function linkExports(importer: ASLModuleRuntime, _exports: ASLExports, imported: ASLModuleRuntime | undefined): Promise<ASLImportResult> {
    if (_exports !== undefined && Object.prototype.hasOwnProperty.call(_exports, ASL_RUNTIME_HOOK_NAME)) {
        // Get environment from context
        const env = importer.__internal.contextRef.deref();

        // TODO(randomuserhi): Better error message
        if (importer === undefined) throw new Error("Cannot link module without an ASL context.");

        // We use the exports as the key to support non-ASL modules with link hooks
        let cache = env.linkedExportsCache.get(_exports);
        if (cache === undefined) {
            cache = new Map();
            env.linkedExportsCache.set(_exports, cache);
        }

        let linkedExports = cache.get(importer);
        if (linkedExports === undefined) {
            linkedExports = await _exports[ASL_RUNTIME_HOOK_NAME](importer, _exports);

            // Copy __esModule tag for es module interop to work properly
            // Assumes that the linked exports and main module use the same convention
            if (_exports.__esModule) {
                if (!linkedExports || !("default" in linkedExports)) 
                    throw new Error("Original module was marked as using ES style default exports, but the linked exports are using common js style. This is not allowed, please use the same convention.");

                Object.defineProperty(linkedExports, "__esModule", {
                    value: _exports.__esModule
                });
            }

            cache.set(importer, linkedExports);

            // Clear out cache on module unload (if its an ASLModule)
            importer.onAbort(() => cache.delete(importer));
        }

        return ASLImportResult(imported, linkedExports);
    }

    return ASLImportResult(imported, _exports);
}

type ASLExecutionContext = Ref<ASLEnvironment>;

/** The result of a executing a module */
class ASLExecutionResult {
    /** 
     * The module exports
     * 
     * Its unsafe to access through this directly if the result has errored as it may be partially constructed.
     * Refer to `.ok()` to check if the result completed succesfully.
     */
    readonly exports: ASLExports;

    /** Error of the import if there was one */
    error: any;

    /** The runtime of the module */
    readonly runtime?: ASLModuleRuntime;

    /**
     * 
     * @param runtime 
     * @param _exports Module exports, named `_exports` to prevent conflicting with commonjs `exports` keyword.  
     * @param error 
     */
    constructor(runtime: ASLModuleRuntime | undefined, _exports: ASLExports | undefined, error: any = ASL_STATUS_CODES.OK) {
        this.exports = _exports;
        this.error = error;
        this.runtime = runtime;
    }

    /** 
     * Checks if the import was succesful
     */
    public ok() {
        return this.error === ASL_STATUS_CODES.OK;
    }
}

export type { ASLExecutionResult };

/**
 * Executes the given module, providing the necessary parameters.
 * 
 * @param entryPoint The ASLModuleFunc of the module being executed.
 */
function ASLExec(moduleInfo: ASLModuleInfo, entryPoint: ASLEntryPoint, runtime: ASLModuleRuntime): Promise<ASLExecutionResult> {
    return new Promise((resolve) => {
        // Setup runtime
        runtime.__internal.resolve = resolve;
        runtime.require = bind(ASLImport, moduleInfo, runtime);

        // runtime is the ASL api
        const __ASL = runtime;

        entryPoint(runtime.require, __ASL, runtime.__internal.exports)
            .then(() => runtime.ready())
            .catch((error) => {
                // Trigger error hook as long as runtime is still part of environment (has not been unloaded)
                if (!runtime.__internal.contextRef.isNull()) {
                    runtime.__internal.contextRef.deref().errorHook(runtime.mid, error);
                }

                resolve(new ASLExecutionResult(runtime, undefined, error));
            });
    });
}

/**
 * Module runtime
 */
export class ASLModuleRuntime {
    readonly __internal: {
        readonly contextRef: ASLExecutionContext;

        readonly exports: ASLExports;

        /** 
         * Tokens used to ensure abort callbacks are only added once. 
         * The token remains valid as long as something has a strong reference to it
         * apart from the runtime itself.
         */
        readonly abortTokens: WeakMap<any, undefined>;

        /** Abort controller to handle module destruction */
        readonly abort: AbortController;

        /** 
         * Special callback used internally that resolves the execution promise created by `execModule`.
         */
        resolve: (result: ASLExecutionResult) => void;
    };
    
    /** Path to the given module */
    public readonly path: string;

    /** module mid */
    public readonly mid: ASLModuleId;

    /** Require func */
    public require: ASLImportFunc = undefined!;

    /** Abort signal to handle module destruction */
    public readonly signal: AbortSignal;

    public error: any = ASL_STATUS_CODES.OK;

    get exports() {
        // TODO(randomuserhi): Better error message
        if (!this.ok()) throw new Error("Cannot access exports for a failed runtime");
        return this.__internal.exports;
    }

    constructor(mid: ASLModuleId, contextRef: ASLExecutionContext) {
        this.path = registry.getPath(mid)!;
        this.mid = mid;

        this.__internal = {
            contextRef,
            exports: {},
            abortTokens: new WeakMap(),
            abort: new AbortController(),
            resolve: undefined!
        };

        this.signal = this.__internal.abort.signal;
    }
    
    /** 
     * Trigger callbacks when module is destructed
     *  
     * @param token A token can be provided which controls whether the callback is added or not.
     *              Once a token has been used, subsequent callbacks using the same token will not be added.
     *              The token remains valid until it is Garbage Collected. The runtime itself holds a weak ref
     *              to the token.
     */
    public onAbort<T extends object>(cb: () => void, token?: T): void {
        if (token !== null && token !== undefined) {
            if (this.__internal.abortTokens.has(token)) return;
            this.__internal.abortTokens.set(token, undefined);
        }

        if (!this.signal.aborted) this.signal.addEventListener("abort", cb);
        else cb();
    }

    /** Is the runtime ok, or did it fail with an error */
    public ok() {
        return this.error === ASL_STATUS_CODES.OK;
    }

    /** Mark module as ready */
    public ready() {
        this.__internal.resolve(new ASLExecutionResult(this, this.__internal.exports));
    }
}

interface ASLExecutionJob extends ASLJob<ASLEnvironment, ASLExecutionResult> {
    /**
     * The module being compiled
     */
    mid: ASLModuleId;
    
    /**
     * Modules waiting for this execution to complete
     */
    requesters: Set<ASLModuleId>;
}

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
     * Set of modules part of this archetype
     */
    readonly modules = new Set<ASLModuleId>();

    /** 
     * Map of archetypes that stem of this one. 
     * As a module imports another, it traverses the add map to find the archetype it belongs to.
     */
    readonly addMap = new Map<ASLModuleId, ASLArchetype>();

    /**
     * @param type Expected to be sorted in ascending order
     * @param typeId string join of type separated by `,` - expected to be in ascending order
     */
    constructor(type: ASLModuleId[], typeId: ASLArchetypeId) {
        this.type = type;
        this.typeId = typeId;
    }
}

/** Manages graph of archetypes */
class ASLArchetypeGraph {
    /**
     * Map of all archetypes that exist on the graph
     */
    readonly archetypes = new Map<ASLArchetypeId, ASLArchetype>();

    /** 
     * Root archetype all modules are part of by default
     */
    private readonly rootArchetype = new ASLArchetype([], "");
    
    /**
     * Archetype associated with each module.
     */
    private readonly moduleArchetype = new Map<ASLModuleId, ASLArchetype>();

    /**
     * Maps a module id to all archetypes that are dependent on it
     */
    private readonly dependentArchetypeMap = new Map<ASLModuleId, Set<ASLArchetype>>();

    constructor() {
        this.archetypes.set(this.rootArchetype.typeId, this.rootArchetype);
    }

    /**
     * Traverses a module through the archetype graph by adding a dependency
     * 
     * @param mid Module to add dependency to
     * @param add Dependency
     */
    public traverse(mid: ASLModuleId, dependency: ASLModuleId) {
        // Module is implicitly dependent on self already
        if (mid === dependency) return;

        let from = this.moduleArchetype.get(mid);
        if (from === undefined) {
            from = this.rootArchetype;
        }

        // Check add map if we have cached the traversal path
        let arch = from.addMap.get(dependency);
        if (arch === undefined) {
            // Otherwise generate new type

            let insertLocation = 0;
            let high = from.type.length;

            while (insertLocation < high) {
                const middle = (insertLocation + high) >>> 1;
                if (from.type[middle] < dependency) {
                    insertLocation = middle + 1;
                } else {
                    high = middle;
                }
            }

            // Module already exists in our archetype, we don't need to traverse anywhere
            if (from.type[insertLocation] === dependency) return;

            // Create a new archetype that contains this module
            const newType = [...from.type];
            newType.splice(insertLocation, 0, dependency);

            const newTypeId = newType.join(",");

            // Try and get archetype from cache
            arch = this.archetypes.get(newTypeId);
            if (arch === undefined) {
                // Create archetype, cache it
                arch = new ASLArchetype(newType, newTypeId);
                this.archetypes.set(newTypeId, arch);

                // Update dependentArchetypeMap with new archetype
                for (const mid of newType) {
                    let dependentArchetypeSet = this.dependentArchetypeMap.get(mid);
                    if (dependentArchetypeSet === undefined) {
                        dependentArchetypeSet = new Set();
                        this.dependentArchetypeMap.set(mid, dependentArchetypeSet);
                    }
                    dependentArchetypeSet.add(arch);
                }
            }

            // update to traversal cache
            from.addMap.set(dependency, arch);
        }

        // Migrate module between archetypes
        this.moduleArchetype.set(mid, arch);
        arch.modules.add(mid);
        from.modules.delete(mid);

        return arch;
    }

    /**
     * Helper for `detach`.
     */
    private _detach(mid: ASLModuleId, detached: Set<ASLModuleId>): void {
        detached.add(mid);

        const arch = this.moduleArchetype.get(mid);
        if (arch !== undefined) {
            // Remove from its own archetype
            this.moduleArchetype.delete(mid);
            arch.modules.delete(mid);
        }

        // Find all modules dependent on this one
        const dependentArchetypes = this.dependentArchetypeMap.get(mid);
        if (dependentArchetypes === undefined) return;

        // Detach all dependent modules
        for (const arch of dependentArchetypes) {
            for (const mid of arch.modules) {
                this._detach(mid, detached);
            }
        }
    }

    /**
     * Detaches a module from the archetype graph, also detaching modules dependent on it
     * 
     * @param mid Module to detach
     * @returns Set of all modules detached as a result
     */
    public detach(mid: ASLModuleId, detached?: Set<ASLModuleId>): Set<ASLModuleId> {
        if (detached === undefined) detached = new Set<ASLModuleId>();
        this._detach(mid, detached);
        return detached;
    }
}

/**
 * ASL Environment.
 */
export class ASLEnvironment {
    /** Module cache. Maps module to the cached module execution result. */
    readonly cache = new Map<ASLModuleId, ASLExecutionResult>();

    /** 
     * For each module export object (ASL or non ASL), store a cache of their linked export variant.
     * The linked export is a version of the original export object, but linked to its ASL importer's runtime.
     */
    readonly linkedExportsCache = new Map<any, Map<ASLModuleRuntime, ASLExports>>();

    /** Stores pending fetch requests for modules. */
    readonly pending = new Map<ASLModuleId, ASLExecutionJob>();

    /** 
     * Stores the runtimes for each module.
     * 
     * Required despite the runtime being stored in `ASLModuleResult` of the cache, as
     * when modules fail the cache value is a Failed result, so the runtime is not accessible.
     * 
     * This stores runtimes of all executed modules, from the moment the runtime is created, thus
     * is available even when a module errors out.
     */
    readonly moduleRuntimes = new Map<ASLModuleId, ASLModuleRuntime>();

    /**
     * Archetype graph for managing dependencies
     */
    readonly archetypeGraph = new ASLArchetypeGraph();

    /**
     * Import hook that the user can define to transform paths before they are used
     */
    public importHook: ASLImportHook = defaultImportHook;

    /**
     * Error hook that the user can define to handle module errors
     */
    public errorHook: ASLErrorHook = defaultErrorHook;

    /**
     * A post-processing step that can be performed on any module exports that implements it.
     *
     * Allows exports to link with an ASL module runtime (typically the runtime importing it) 
     * to produce a different set of exports specific to said runtime.
     * 
     * ASL require calls automatically perform this step (unlike `ASLEnvironment.fetch`) which allows
     * modules implementing this to be aware of the importer, providing access to the importer's runtime.
     * It may then return different exports depending on the importer.
     * 
     * @param importer The runtime for the module performing the import
     * @param exports The exports of the imported module
     * @param imported The runtime of the imported module (if the exports originate from an ASLModule)
     * @returns linked exports
     */
    public linkExports = linkExports;

    /**
     * Updates the dependency graph of the provided module.
     * 
     * @param module Module to update dependencies of
     * @param dependency Dependency to add to module
     */
    public updateDependencyGraph(module: ASLModuleId, dependency: ASLModuleId) {
        this.archetypeGraph.traverse(module, dependency);
    }

    /**
     * Cancels the execution of a given module.
     * 
     * @param resolve `resolve` function from the execution promise
     */
    private static cancel(runtime: ASLModuleRuntime, resolve: (result: ASLExecutionResult) => void) {
        // mark execution as cancelled
        runtime.error = new ASLExecutionCancelledError();
        resolve(new ASLExecutionResult(runtime, undefined, runtime.error));
    }

    /**
     * Loads a module into the environment
     * 
     * Note does not update the modules dependency graph, even if a requester is provided.
     * Use `updateDependencyGraph` to update the modules dependencies.
     * 
     * Also does not perform the post-processing step to obtain linked exports.
     * Use `getLinkedExports` to obtain them manually.
     * 
     * @param mid module id
     * @param requester the module making the request - used for debugging
     */
    public fetch(mid: ASLModuleId, requester?: ASLModuleRuntime): Promise<ASLExecutionResult>

    /**
     * Loads a module into the environment
     * 
     * Note does not update the modules dependency graph, even if a requester is provided.
     * Use `updateDependencyGraph` to update the modules dependencies.
     * 
     * Also does not perform the post-processing step to obtain linked exports.
     * Use `getLinkedExports` to obtain them manually.
     * 
     * @param path File path to module
     * @param requester the module making the request - used for debugging
     */
    public fetch(path: string, requester?: ASLModuleRuntime): Promise<ASLExecutionResult>

    public fetch(mid: string | ASLModuleId, requester?: ASLModuleRuntime): Promise<ASLExecutionResult> {
        // Resolve mid from path
        if (typeof mid === "string") {
            mid = registry.getMid(mid);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let execution = this.pending.get(mid);

        if (execution === undefined) {
            // If module is not pending, create the request

            const _execution: ASLExecutionJob = {
                mid,
                contextRef: new Ref(this),
                job: undefined!,
                cancel: undefined!,
                requesters: new Set()
            };

            _execution.job = new Promise<ASLImportResult>((resolve) => {
                // Get reference to execution context
                const contextRef = _execution.contextRef;

                // Try get module from cache
                if (this.cache.has(mid)) {
                    // Settle promise based on cached result, as this resolves immediately, we don't need to handle cancellation
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    
                    // Create module runtime - the runtime must always exist even if the module doesn't (fails to fetch)
                    // to handle hot reloading once the module does become available.
                    const runtime = new ASLModuleRuntime(mid, contextRef);
                    if (this.moduleRuntimes.has(mid)) {
                        // TODO(randomuserhi): Better Error
                        runtime.error = new Error("ModuleData for this module already exists. This should never happen!");
                        resolve(new ASLExecutionResult(runtime, undefined, runtime.error));
                    }
                    this.moduleRuntimes.set(mid, runtime);

                    // Assign cancel function
                    _execution.cancel = bind(ASLEnvironment.cancel, runtime, resolve);

                    registry.compile(mid, this).then(result => {
                        if (!result.ok()) throw result.error;

                        // Check if execution context is still valid
                        contextRef.deref();

                        // Execute module
                        return result.module.exec(runtime);
                    }).then((result) => {
                        // Get execution context
                        const context = contextRef.deref();

                        // Store module result into cache
                        context.cache.set(mid, result);

                        // Resolve execution with result
                        resolve(result);
                    }).catch((error) => {
                        if (runtime.ok()) {
                            // Mark runtime as failing with said error, if it hasn't already failed for another reason
                            // such as if the execution was cancelled.
                            runtime.error = error;
                        }

                        // Create error result
                        const result = new ASLExecutionResult(runtime, undefined, runtime.error);

                        if (!contextRef.isNull()) {
                            // Store error result into cache, if we are still bound to the environment
                            // (execution has not been cancelled)
                            const context = contextRef.deref();
                            context.cache.set(mid, result);
                        }

                        // Reject main fetch request
                        resolve(result);
                    });
                }
            });

            // Add to map of pending requests
            execution = _execution;
            this.pending.set(mid, execution);

            // Clean up execution on completion
            _execution.job.then(() => {
                // Check if module is still bound to an execution context,
                // If not then the module must have been detached (unloaded from environment)
                // and thus should not do anything.
                if (_execution.contextRef.isNull()) return;

                const context = _execution.contextRef.deref();
                context.cleanupPendingExecution(_execution);
            });
        }

        // Keep track of the requester
        if (requester !== undefined) execution.requesters.add(requester.mid);

        return execution.job;
    }

    /**
     * Cleans up the pending request
     * 
     * @param execution Pending execution
     */
    private cleanupPendingExecution(execution: ASLExecutionJob) {
        // Remove from pending for book keeping
        if (!this.pending.delete(execution.mid)) throw new Error("Could not find pending execution job.");
    }

    /**
     * Auxilary method for `unload` that unloads a single module and adds its abort controller to a set
     * 
     * @param mid Module to unload
     * @param abortControllers Set of abort controllers
     */
    private _unload(mid: ASLModuleId, abortControllers: Set<AbortController>) {
        const request = this.pending.get(mid);
        if (request !== undefined) {
            // If module is pending, cancel it and clean up the execution
            request.cancel();
            this.cleanupPendingExecution(request);
        } else if (!this.cache.delete(mid)) {
            // Otherwise, if it is in cache, delete it. If it is not in the cache, 
            // then module was never loaded and we can early return
            return;
        }

        // Get runtime
        const runtime = this.moduleRuntimes.get(mid);
        if (runtime === undefined) throw new Error(`Unable to find runtime for module: ${mid} being unloaded.`);

        // Unbind runtime from the environment
        runtime.__internal.contextRef.set(Ref.NULLPTR);
        
        // Delete runtime
        this.moduleRuntimes.delete(mid);
        
        // Collect module destructors
        abortControllers.add(runtime.__internal.abort);
        
        // Clear out cache linked export cache
        this.linkedExportsCache.delete(runtime.__internal.exports);
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
            this.archetypeGraph.detach(mid, unloadedModules);
        }

        const abortControllers = new Set<AbortController>();
        for (const mid of unloadedModules) {
            this._unload(mid, abortControllers);
        }
        
        // Trigger destructors, we do this after unload process such that
        // if a destructor triggers a re-import, it doesnt break the archetype graph 
        // (destructor is called during unload process, so subsequent unload after re-import may delete
        // a still used archetype)
        for (const controller of abortControllers) {
            controller.abort();
        }

        return unloadedModules;
    }

    /**
     * Invalidates the given module, causing it to reload. 
     * Subsequently reloads modules that depend on it.
     * 
     * @param path Module to invalidate
     */
    public invalidate(paths: string[]): Promise<ASLImportResult[]>

    /**
     * Invalidates the given module, causing it to reload. 
     * Subsequently reloads modules that depend on it.
     * 
     * @param mid Module to invalidate
     */
    public invalidate(mids: ASLModuleId[]): Promise<ASLImportResult[]>

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
        return Promise.all(promises);
    }
}

///
/// Errors
///

/**
 * Error that occurs when module fetch is cancelled
 */
export class ASLCompilationCancelledError extends Error {
    constructor() {
        super("Module compilation was cancelled.");
        this.name = "ASLCompilationCancelledError";
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ASLCompilationCancelledError);
        }
    }
}

/**
 * Error that occurs when execution is cancelled
 */
export class ASLExecutionCancelledError extends Error {
    constructor() {
        super(`Module execution was cancelled.`);
        this.name = "ASLExecutionCancelledError";
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ASLExecutionCancelledError);
        }
    }
}

/**
 * Error that occurs whilst importing modules
 */
export class ASLImportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ASLImportError";
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ASLImportError);
        }
    }
}