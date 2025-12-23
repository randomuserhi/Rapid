export { };

type ASLModuleObject = Record<PropertyKey, any>;

/** The result of a module execution */
interface ASLModuleResult {
    /** The module exports */
    readonly exports: ASLModuleObject;

    /** The runtime of the module */
    readonly runtime?: ASLModuleRuntime;
}

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

type ASLImportFunc = (path: string, options?: Partial<ASLImportOptions>) => Promise<ASLModuleResult>;

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

        readonly mid: ASLModuleId

        /** 
         * Marks the module's exports as ready prior to end of module execution.
         * Used to resolve circular dependencies.
         */
        ready(): void;

        /**
         * Module exports
         */
        exports: ASLModuleObject;

        /**
         * Require function
         */
        require: ASLImportFunc;

        /**
         * Adds a callback that executes when the module is destructed
         * @param cb Callback to run
         */
        onAbort(cb: () => void): void;

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
     * @param runtime The runtime of the module performing the import of the current module.
     * @param exports The immutable exports of the current module.
     */
    type __linkASLRuntime = (runtime: ASLModuleRuntime, exports: ASLModuleObject) => ASLModuleObject | Promise<ASLModuleObject>;

    const __ASL: ASLModuleRuntime;

    const __ASL_require: ASLImportFunc;

    const __ASL_exports: ASLModuleObject;
}