/**
 * Async Script Loader (Node version)
 * 
 * @randomuserhi 2025
 */

/** Base URL used for file resolution */
let ASL_BASE_URL: URL | undefined = undefined;
export function setASLBaseURL(url: string | URL) {
    if (typeof url === "string") url = new URL(url);
    ASL_BASE_URL = url;
}
export function getASLBaseURL() {
    return ASL_BASE_URL;
}

let ASL_IS_CASE_SENSITIVE: boolean = true;
export function setASLIsCaseSensitive(value: boolean) {
    ASL_IS_CASE_SENSITIVE = value;
}

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

/** Gets package name from an import path */
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

export const ASL_EXTENSION = ".asl";
export const ASL_EXTENSION_TS = `${ASL_EXTENSION}.ts`;
export const ASL_EXTENSION_JS = `${ASL_EXTENSION}.js`;
export const ASL_EXTENSION_JS_MAP = `${ASL_EXTENSION}.js.map`;

/** Module ID type */
export type ASLModuleId = number;

/**
 * Module object, represents exports for a module.
 */
export type ASLModuleObject = any;

/** Function that imports another module from an ASL module execution context. */
type ASLEnvImportFunc = (moduleInfo: ASLModuleInfo, runtime: ASLModuleRuntime, path: string, options?: Partial<ASLImportOptions>) => Promise<ASLModuleObject>;

/** Function that imports another module from an ASL module execution context. */
type ASLImportFunc = (path: string, options?: Partial<ASLImportOptions>) => Promise<ASLModuleObject>;

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
 */
interface ASLImportOptions {
    /** 
     * Is the type of import a default import? `import X from "X.js"` 
     * 
     * default: false
     */
    defaultImport: boolean;

    /** 
     * Should the import count as a dependency? 
     * If so, then invalidating that import also invalidates this module.
     * 
     * default: true
     */
    updateDependencyGraph: boolean;
}

/**
 * Module runtime
 */
export class ASLModuleRuntime {
    /** Path to the given module */
    public readonly path: string;

    /** module mid */
    public readonly mid: ASLModuleId;

    /**
     * Module exports object
     */
    public readonly exports: ASLModuleObject;

    /**
     * Require func
     */
    public readonly require: ASLImportFunc = undefined!;

    constructor(info: ASLModuleInfo) {
        this.path = info.path;
        this.mid = info.mid;
        this.exports = {};
    }

    /** Abort controller to handle module destruction */
    private readonly abort = new AbortController();
    
    /** Abort signal to handle module destruction */
    public readonly signal = this.abort.signal;
    
    /** Trigger callbacks when module is destructed */
    public onAbort(cb: () => void) {
        this.abort.signal.addEventListener("abort", cb);
    }

    /** 
     * Special callback used internally that resolves the execution promise created by `execModule`.
     */
    private resolve: (result: ASLModuleResult) => void = undefined!;

    /** Mark module as ready */
    public ready() {
        this.resolve(new ASLModuleResult(this.exports, this));
    }
}

export interface ASLModuleInfo {
    /** Module path (normalized) */
    readonly path: string;

    /** Module id */
    readonly mid: ASLModuleId;
}

/**
 * ASLModule information.
 * 
 * Contains information about the module, such as its archetype and execution function.
 */
class ASLModule {
    readonly info: ASLModuleInfo;
    
    /**
     * Executes the given module, returning the module object containing its exports.
     */
    readonly exec: (aslImport: any, runtime: ASLModuleRuntime) => ASLRequest<ASLModuleResult> = undefined!;
    
    constructor(mid: ASLModuleId, path: string) {
        this.info = {
            path,
            mid
        };
    }
}

/**
 * A result for a given request.
 * Can be checked if the result is available or if it errored.
 * 
 * This is preferred over Promise as handling uncaught exceptions in promises is
 * difficult to maintain.
 */
class ASLRequestResult<T, ErrorType = any> {
    private static OK = Symbol("ASLRequestResult.OK");

    error: typeof ASLRequestResult<T, ErrorType>["OK"] | ErrorType;
    item: T;

    constructor(result?: T, error: ASLRequestResult<T, ErrorType>["error"] = ASLRequestResult.OK) {
        this.item = result!;
        this.error = error;
    }

    public ok() {
        return this.error === ASLRequestResult.OK;
    }
}

/**
 * Static resolve handler for `Request`s.
 */
function ASLRequestResolve<T, ErrorType = any>(resolve: (value: ASLRequestResult<T, ErrorType> | PromiseLike<ASLRequestResult<T, ErrorType>>) => void) {
    return (result: T | PromiseLike<T>) => {
        if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as PromiseLike<T>).then === "function") {
            // If result is PromiseLike, we have to .then it
            (result as PromiseLike<T>).then((result) => resolve(new ASLRequestResult<T, ErrorType>(result)));
        } else {
            resolve(new ASLRequestResult<T, ErrorType>(result as T));
        }
    };
}

/**
 * Creates a Promise that returns an ASLRequestResult object instead.
 * These promises never throw.
 */
function ASLRequest<T, ErrorType = any>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: ErrorType) => void) => void): Promise<ASLRequestResult<T, ErrorType>> {
    return new Promise<ASLRequestResult<T, ErrorType>>((resolve, reject) => {
        executor(ASLRequestResolve(resolve), reject);
    }).catch(reason => new ASLRequestResult<T, ErrorType>(undefined, reason));
}

/**
 * ASL Request type
 */
type ASLRequest<T, ErrorType = any> = Promise<ASLRequestResult<T, ErrorType>>;

/**
 * ASL Request with a context object, used to associate a request with a given object.
 * 
 * This is used to handle cancelling requests as javascript doesn't let you cancel execution.
 * Instead, the request interacts with external resources via its associated context, and by
 * unbinding the context we can mimic cancelling its execution.
 */
interface ASLRequestWithContext<T, Context, ErrorType = any> {
    contextRef: Ref<Context>;
    request: ASLRequest<T, ErrorType>;
    cancel: (reason?: any) => void;
}

/**
 * Fetch request for module information. Used by Registry.
 */
interface ASLModuleFetchRequest extends ASLRequestWithContext<ASLModule, ASLRegistry> {
    mid: ASLModuleId
}

/**
 * Error that occurs when module fetch is cancelled
 */
export class ASLModuleFetchCancelledError extends Error {
    constructor() {
        super("Module fetch was cancelled.");
        this.name = "ASLModuleFetchCancelledError";
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ASLModuleFetchCancelledError);
        }
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
        path = new URL(path, ASL_BASE_URL).toString();

        if (!ASL_IS_CASE_SENSITIVE) path = path.toLowerCase();

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
    private readonly pending = new Map<ASLModuleId, ASLModuleFetchRequest>();

    /** 
     * Dependency map of module to ASL environment.
     * 
     * When a given module is hot reloaded, we know which environments are affected.
     */
    private readonly dependencies = new Map<ASLModuleId, Set<ASLEnvironment>>();

    /**
     * Cancels a given request for a module.
     * 
     * @param fetchRequest Request to cancel
     * @param reject `reject` function used to settle the request promise
     */
    private cancelModuleFetchRequest(fetchRequest: ASLModuleFetchRequest, reject: (reason?: any) => void) {
        // Unbind from context
        fetchRequest.contextRef.set(Ref.NULLPTR);

        // Remove from pending
        this.pending.delete(fetchRequest.mid);

        // Reject request promise
        reject(new ASLModuleFetchCancelledError());
    }

    /**
     * Loads a module into cache.
     * 
     * @param mid module id to fetch
     * @param env Environment that is fetching the module - used internally for book keeping dependencies for hot reloading
     * @returns The loaded module information
     */
    public fetch(mid: ASLModuleId, env?: ASLEnvironment): ASLRequest<ASLModule> {
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
        let fetchRequest = this.pending.get(mid);

        if (fetchRequest === undefined) {
            // If module is not pending, create the request

            const _fetchRequest: ASLModuleFetchRequest = {
                mid,
                contextRef: new Ref(this),
                request: undefined!,
                cancel: undefined!
            };
            _fetchRequest.request = ASLRequest((resolve, reject) => {
                _fetchRequest.cancel = this.cancelModuleFetchRequest.bind(this, _fetchRequest, reject);

                // Try get module from cache
                if (this.cache.has(mid)) {
                    resolve(this.cache.get(mid)!);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    fetch(path, { method: "GET" }).then((req) => {
                        if (req.ok) {
                            return req.text();
                        } else throw new Error(`Unable to fetch ASL module: ${req.statusText} (${req.status})`);
                    }).then(code => {
                        // Get request context
                        const context = _fetchRequest.contextRef.deref();

                        // Create module function.
                        // This runs in an async function as ASL needs to support the `await` keyword at the top-level.
                        // The function has the parameters `require`, `module` and `exports` to provide the necessary keywords.
                        //
                        // Note that `require` refers to `aslImport`, in ASL scripts the keyword is `require` for simplicity.
                        const moduleFunc = (new Function(`return (async (__ASL_require, __ASL, __ASL_exports) => {${code}\n});\n//# sourceMappingURL=${path}.map`))() as ASLModuleFunc;

                        // Create module info
                        const aslModule = new ASLModule(mid, path);
                        (aslModule as any).exec = context.execModule.bind(context, aslModule.info, moduleFunc);

                        // Add to cache
                        context.cache.set(mid, aslModule);

                        // Resolve request
                        resolve(aslModule);
                    }).catch(reject);
                }
            });

            // Add to map of pending requests
            fetchRequest = _fetchRequest;
            this.pending.set(mid, fetchRequest);

            // When request successfully finishes, remove from pending
            _fetchRequest.request.then(() => {
                // Check if request is still bound to request context,
                // If not then the module must have been detached (unloaded from registry)
                // and thus should not do anything.
                if (_fetchRequest.contextRef.isNull()) return;

                const context = _fetchRequest.contextRef.deref();
                context.pending.delete(mid);
            });
        }

        return fetchRequest.request;
    }

    /**
     * Executes the given module, providing the necessary parameters.
     * 
     * @param moduleFunc The ASLModuleFunc of the module being executed.
     */
    private execModule(moduleInfo: ASLModuleInfo, moduleFunc: ASLModuleFunc, envImport: ASLEnvImportFunc, runtime: ASLModuleRuntime): ASLRequest<ASLModuleResult> {
        return ASLRequest((resolve, reject) => {
            // Setup runtime
            runtime["resolve"] = resolve;
            (runtime as any).require = bind(envImport, moduleInfo, runtime);

            // runtime is the ASL api
            const __ASL = runtime;

            moduleFunc(runtime.require, __ASL, runtime.exports)
                .then(() => runtime.ready())
                .catch((err) => reject(err));
        });
    }

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param path Module to mark as invalidated
     */
    public invalidate(paths: string[]): Promise<ASLRequestResult<ASLModuleObject>[][]>;

    /**
     * Invalidates a module. All environments including said module will automatically reload said module.
     * 
     * @param mid Module to mark as invalidated
     */
    public invalidate(mids: ASLModuleId[]): Promise<ASLRequestResult<ASLModuleObject>[][]>;

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
            // If module is pending, cancel it
            const pending = this.pending.get(mid);
            if (pending !== undefined) {
                pending.cancel();
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

/**
 * Error that occurs when execution is cancelled
 */
export class ASLExecutionCancelledError extends Error {
    constructor() {
        super("Module execution was cancelled.");
        this.name = "ASLExecutionCancelledError";
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, ASLExecutionCancelledError);
        }
    }
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

// Default runtime hook function name
const RUNTIME_HOOK_NAME = "__linkASLRuntime";

/** link hook function type. */
export type __linkASLRuntime = (runtime: ASLModuleRuntime, exports: ASLModuleObject) => ASLModuleObject;

/** By default, resolve relative paths based on importing module */
export const defaultImportHook = async (module: ASLModuleInfo, path: string) => {
    return new URL(path, path.startsWith(".") ? module.path : ASL_BASE_URL).toString();
};

/** By default, console log error */
export const defaultErrorHook = (mid: ASLModuleId, error?: any) => {
    console.error(`${registry.getPath(mid)}:`, error);
};

type ASLExecutionContext = Ref<ASLEnvironment>;

interface ASLExecution extends ASLRequestWithContext<ASLModuleResult, ASLEnvironment> {
    mid: ASLModuleId;
    requesters: Set<ASLModuleId>;
}

/** Function called on import */
export type ASLImportHook = (module: ASLModuleInfo, path: string, options?: ASLImportOptions) => Promise<string | ASLModuleObject>;

/** Function called on error */
export type ASLErrorHook = (mid: ASLModuleId, error?: any) => void;

/** 
 * Function called when an import has finished running 
 *
 * @param runtime The runtime of the module performing the import on the current module
 * @param exports The exports of the current module
 */
export type ASLRuntimeHook = (runtime: ASLModuleRuntime, exports: ASLModuleObject) => Promise<ASLModuleObject>;

/** The result of a module execution */
class ASLModuleResult {
    /** The module exports */
    readonly exports: ASLModuleObject;

    /** The runtime of the module */
    readonly runtime?: ASLModuleRuntime;

    constructor(exports: ASLModuleObject, runtime?: ASLModuleRuntime) {
        this.exports = exports;
        this.runtime = runtime;
    }
}

/**
 * ASL Environment.
 */
export class ASLEnvironment {
    /** Module cache. Maps module to the cached module object. */
    private readonly cache = new Map<ASLModuleId, ASLRequestResult<ASLModuleResult>>();

    /** Stores pending fetch requests for modules. */
    private readonly pending = new Map<ASLModuleId, ASLExecution>();

    /** 
     * Stores the runtimes for each module.
     * 
     * Required despite the runtime being stored in `ASLModuleResult` of the cache, as
     * when modules fail the cache value is a Failed result, so the runtime is not accessible.
     * 
     * This stores runtimes of all executed modules, from the moment the runtime is created, thus
     * is available even when a module errors out.
     */
    private readonly moduleRuntimes = new Map<ASLModuleId, ASLModuleRuntime>();

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
    private readonly typemap = new Map<ASLModuleId, Set<ASLArchetype>>();

    /**
     * Import hook that the user can define to transform paths before they are used
     */
    public importHook: ASLImportHook = defaultImportHook;

    /**
     * Error hook that the user can define to handle module errors
     */
    public errorHook: ASLErrorHook = defaultErrorHook;

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
            archList = new Set();
            this.typemap.set(mid, archList);
        }
        archList.add(arch);

        // update to traversal cache
        from.addMap.set(mid, arch);
        arch.removeMap.set(mid, from);

        return arch;
    }

    /**
     * Import function used by executing modules when they are executed to import other modules into
     * the given environment.
     * 
     * @param contextRef The execution context for the given module
     * @param moduleInfo The information about the module making the import
     * @param runtime The module runtime of the module making the import
     * @param path File path to module being imported
     * @param options Import options
     * @returns Promise that resolves to the module's exports
     */
    private import(contextRef: ASLExecutionContext, moduleInfo: ASLModuleInfo, runtime: ASLModuleRuntime, path: string, options?: Partial<ASLImportOptions>): Promise<ASLModuleResult> {
        // Create default options
        const parsedOptions: ASLImportOptions = {
            defaultImport: false,
            updateDependencyGraph: true
        };

        // Parse provided options
        if (options !== undefined) {
            for (const key in options) {
                const k = key as keyof ASLImportOptions;
                if (Object.prototype.hasOwnProperty.call(options, k)) {
                    parsedOptions[k] = options[k] as any;
                }
            }
        }

        // Runtime of imported module, if imported module is not ASL, then this will be undefined
        let importedRuntime: ASLModuleRuntime | undefined = undefined;

        // Pass path through import hook
        return this.importHook(moduleInfo, path, parsedOptions).then(path => {
            // If import hook returned an object directly, use that instead
            if (typeof path !== "string") return path;

            // Resolve type of import
            const importType = extname(path);

            switch (importType) {
            case ASL_EXTENSION:
            case ASL_EXTENSION_JS: {
                // ASL import
            
                const mid = registry.getMid(path);
            
                if (mid === moduleInfo.mid) throw new ASLImportError("Cannot import self.");
            
                const env = contextRef.deref();
            
                if (parsedOptions.updateDependencyGraph) {
                    env.updateDependencyGraph(moduleInfo.mid, mid);
                }
            
                // Can return directly as ASL handles linking runtime automatically
                return env.fetch(mid, runtime.mid).then((result) => {
                    if (!result.ok()) throw new ASLImportError(`Requested module threw an error.`);

                    importedRuntime = result.item.runtime;
                    return result.item.exports;
                });
            }
            case ".node": {
                // Node import
                        
                throw new ASLImportError(`Web based ASL does not support '.node' (native addons) style imports.`);
            }
            case ".cjs": {
                // Node import
                        
                throw new ASLImportError(`Web based ASL does not support '.cjs' style imports.`);
            }
            
            case ".js":
            case ".mjs": {
                // ESM import
            
                return import(path);
            }
            }
            
            throw new Error("ASL imports require an extension to distinguish between ASL, MJS or CJS style import.");
        }).then((exports) => {
            // Perform post-processing step on exports
            return this.getLinkedExports(runtime, exports, importedRuntime);
        }).then((exports) => {
            // Handle default imports - supports interop for es modules etc...
            if (exports !== undefined && parsedOptions.defaultImport && Object.prototype.hasOwnProperty.call(exports, "default")) {
                return exports.default;
            }
            return exports;
        }).then((exports) => {
            // Wrap in module result
            return new ASLModuleResult(exports, importedRuntime);
        });
    }

    /**
     * Updates the dependency graph of the provided module.
     * 
     * @param module Module to update dependencies of
     * @param dependency Dependency to add to module
     */
    public updateDependencyGraph(module: ASLModuleId, dependency: ASLModuleId) {
        // Update modules archetype as approapriate
        const arch = this.moduleArchetype.get(module)!;
        this.moduleArchetype.set(module, this.traverse(arch, dependency));
    }

    /** 
     * For each module export object (ASL or non ASL), store a cache of their linked export variant.
     * The linked export is a version of the original export object, but linked to its ASL importer's runtime.
     */
    private readonly linkedExportsCache = new Map<any, Map<ASLModuleRuntime, ASLModuleObject>>();

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
     * @param importer The runtime performing the import
     * @param exports The exports of the importee
     * @param imported The runtime of the importee (if the exports originate from an ASLModule)
     * @returns linked exports
     */
    public async getLinkedExports(importer: ASLModuleRuntime | undefined, exports: ASLModuleObject, imported: ASLModuleRuntime | undefined) {
        if (exports !== undefined && Object.prototype.hasOwnProperty.call(exports, RUNTIME_HOOK_NAME)) {
            // TODO(randomuserhi): Better error message
            if (importer === undefined) throw new Error("Cannot link module without an ASL context.");

            // We use the exports as the key to support non-ASL modules with link hooks
            let cache = this.linkedExportsCache.get(exports);
            if (cache === undefined) {
                cache = new Map();
                this.linkedExportsCache.set(exports, cache);

                // Clear out cache on module unload (if its an ASLModule)
                imported?.onAbort(() => this.linkedExportsCache.delete(exports));
            }

            let linkedExports = cache.get(importer);
            if (linkedExports === undefined) {
                linkedExports = await exports[RUNTIME_HOOK_NAME](importer);
                cache.set(importer, linkedExports);

                // Clear out cache on module unload (if its an ASLModule)
                importer.onAbort(() => cache.delete(importer));
            }

            return linkedExports;
        }
        return exports;
    }

    /**
     * Cancels the execution of a given module.
     * 
     * @param execution Execution to cancel
     * @param reject `reject` function from the execution promise
     */
    private cancelModuleExecution(execution: ASLExecution, reject: (reason?: any) => void) {
        // Unbind execution context
        execution.contextRef.set(Ref.NULLPTR);

        // Remove from pending
        this.pending.delete(execution.mid);

        // Reject execution promise
        reject(new ASLExecutionCancelledError());
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
    public fetch(mid: ASLModuleId, requester?: ASLModuleId): ASLRequest<ASLModuleResult>

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
    public fetch(path: string, requester?: ASLModuleId): ASLRequest<ASLModuleResult>

    public fetch(mid: string | ASLModuleId, requester?: ASLModuleId): ASLRequest<ASLModuleResult> {
        // Resolve mid from path
        if (typeof mid === "string") {
            mid = registry.getMid(mid);
        }

        // Get pending request if module has been loaded before but is still waiting.
        let execution = this.pending.get(mid);

        if (execution === undefined) {
            // If module is not pending, create the request

            const _execution: ASLExecution = {
                mid,
                contextRef: new Ref(this),
                request: undefined!,
                cancel: undefined!,
                requesters: new Set()
            };

            _execution.request = ASLRequest<ASLModuleResult>((resolve, reject) => {
                _execution.cancel = this.cancelModuleExecution.bind(this, _execution, reject);

                // Get reference to execution context
                const contextRef = _execution.contextRef;

                // Try get module from cache
                if (this.cache.has(mid)) {
                    // Settle promise based on cached result
                    const cachedResult = this.cache.get(mid)!;
                    if (cachedResult.ok()) resolve(cachedResult.item);
                    else reject(cachedResult.error);
                } else {
                    // If its not in cache or pending, make a request to fetch it
                    const moduleInfoRequest = registry.fetch(mid, this);

                    moduleInfoRequest.then(result => {
                        if (!result.ok()) throw result.error;

                        // Get execution context
                        const context = contextRef.deref();

                        // Assign archetype
                        context.moduleArchetype.set(mid, context.traverse(context.rootArchetype, mid));

                        // Create module data
                        const runtime = new ASLModuleRuntime(result.item.info);
                        // TODO(randomuserhi): Better Error
                        if (context.moduleRuntimes.has(mid)) throw new Error("ModuleData for this module already exists. This should never happen!");
                        context.moduleRuntimes.set(mid, runtime);

                        // Execute module
                        return result.item.exec(context.import.bind(context, contextRef), runtime);
                    }).then((result) => {
                        // Get execution context
                        const context = contextRef.deref();

                        // Store module object into cache
                        context.cache.set(mid, result);

                        // Settle promise based on result state
                        if (result.ok()) resolve(result.item);
                        else reject(result.error);
                    }).catch(reject);
                }
            });

            // Add to map of pending requests
            execution = _execution;
            this.pending.set(mid, execution);

            // Clean up request on finish
            _execution.request.then((result) => {
                // Check if module is still bound to an execution context,
                // If not then the module must have been detached (unloaded from environment)
                // and thus should not do anything.
                if (_execution.contextRef.isNull()) return;

                const context = _execution.contextRef.deref();

                // Trigger error hook
                if (!result.ok()) {
                    context.errorHook(mid, result.error);
                }

                // Remove from pending for book keeping
                context.pending.delete(mid);
            });
        }

        // Keep track of the requester
        if (requester !== undefined) execution.requesters.add(requester);

        return execution.request;
    }

    /**
     * Auxilary method for `unload`
     * 
     * @param mid Module to unload
     * @param unloadedModules set of modules that were unloaded
     */
    private _unload(mid: ASLModuleId, unloadedModules: Set<ASLModuleId>, abortControllers: Set<AbortController>) {
        // If module is pending, cancel it
        const request = this.pending.get(mid);
        if (request !== undefined) {
            request.cancel();
        } else if (!this.cache.delete(mid)) {
            // Otherwise, if it is in cache, delete it. If it is not in the cache, 
            // then module was never loaded and we can early return
            return;
        }

        // Add to set of unloaded modules
        unloadedModules.add(mid);

        // collect module destructors and delete module runtime
        const runtime = this.moduleRuntimes.get(mid);
        if (runtime === undefined) throw new Error(`Unable to find runtime for module: ${mid} being unloaded.`);
        abortControllers.add(runtime["abort"]);
        this.moduleRuntimes.delete(mid);

        // Unload modules that depend on this one
        const archetypesContainingModule = this.typemap.get(mid);
        if (archetypesContainingModule === undefined) return;

        for (const archetype of archetypesContainingModule) {
            for (const module of archetype.type) {
                this._unload(module, unloadedModules, abortControllers);
            }
        }

        // Remove module from dependency in registry
        const dependencies: Map<ASLModuleId, Set<ASLEnvironment>> = (registry as any).dependencies;
        dependencies.get(mid)?.delete(this);

        // Remove module from archetype book keeping
        const archetype = this.moduleArchetype.get(mid);
        if (archetype !== undefined) {
            for (const module of archetype.type) {
                this.typemap.get(module)?.delete(archetype);
            }
            this.moduleArchetype.delete(mid);
        }
        this.typemap.delete(mid);

        // Detach from archetype graph cache (addMap, removeMap) and general cache
        for (const archetype of archetypesContainingModule) {
            archetype.removeMap.get(mid)!.addMap.delete(mid);
            this.archetypes.delete(archetype.typeId);
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
        const abortControllers = new Set<AbortController>();
        for (const mid of mids) {
            this._unload(mid, unloadedModules, abortControllers);
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
    public invalidate(paths: string[]): Promise<ASLRequestResult<ASLModuleObject>[]>

    /**
     * Invalidates the given module, causing it to reload. 
     * Subsequently reloads modules that depend on it.
     * 
     * @param mid Module to invalidate
     */
    public invalidate(mids: ASLModuleId[]): Promise<ASLRequestResult<ASLModuleObject>[]>

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