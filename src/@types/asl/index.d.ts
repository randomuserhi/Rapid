export { };

type ASLModuleObject = any;

/** The result of a module execution */
interface ASLImportResult {
    /** Error of the import if there was one */
    readonly error: any;

    /** The runtime of the module */
    readonly runtime?: ASLModuleRuntime;

    /**
     * Obtain the exports from the import.
     * 
     * Throws an error if the import had failed. Can be checked manually with `.ok()`
     */
    readonly exports: ASLModuleObject;

    /** 
     * Checks if the import was succesful
     */
    ok(): boolean;
}

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
    importType?: ".mjs" | ".js" | ".asl" | ".cjs" | ".node" | ".asl.ts" | ".asl.js";
}

type ASLImportFunc = (path: string, options?: Partial<ASLImportOptions>) => Promise<ASLImportResult>;

declare global {
    type ASLModuleId = number;

    interface ASLModuleInfo {
        /** Module path (normalized) */
        readonly path: string;

        /** Module id */
        readonly mid: ASLModuleId;
    }

    interface ASLModuleRuntime {
        /** Path to module file */
        readonly path: string;

        /** Module ID */
        readonly mid: ASLModuleId;

        /**
         * Did the runtime execute succesfully?
         * The error can be read from `.error` if it did not run succesfully.
         */
        ok(): boolean

        /**
         * Error, if any occured.
         */
        error: any;

        /** 
         * Marks the module's exports as ready prior to end of module execution.
         * Used to resolve circular dependencies.
         */
        ready(): void;

        /**
         * Module exports
         * 
         * If the runtime has errored, the state of exports is unknown and cannot be relied upon.
         * Please check the state of the runtime using `.ok()` first.
         */
        exports: ASLModuleObject;

        /**
         * Require function
         */
        require: ASLImportFunc;

        /** 
         * Trigger callbacks when module is destructed 
         * 
         * @param cb The callback to run
         * @param token A token can be provided which controls whether the callback is added or not.
         *              Once a token has been used, subsequent callbacks using the same token will not be added.
         *              The token remains valid until it is Garbage Collected. The runtime itself holds a weak ref
         *              to the token.
         */
        onAbort<T extends object>(cb: () => void, token?: T): void;

        /**
         * Abort signal that triggers when module is destructed
         */
        readonly signal: AbortSignal;
    }

    /**
     * Special callback called when another module imports this one.
     * Allows binding the runtime of the module performing the import to internal functions.
     * 
     * Often used for automatic cleanup of resources when the importing module is destructed.
     * 
     * @param runtime The runtime of the ASL module performing the import of the current module. Undefined if imported from a non-ASL context.
     * @param exports The immutable exports of the current module.
     */
    type __linkASLRuntime = (runtime: ASLModuleRuntime, exports: ASLModuleObject) => ASLModuleObject | Promise<ASLModuleObject>;

    const __ASL: ASLModuleRuntime;

    const __ASL_require: ASLImportFunc;

    const __ASL_exports: ASLModuleObject;
}