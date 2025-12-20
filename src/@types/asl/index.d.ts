export { };

type ASLModuleObject = Record<PropertyKey, any>;

declare global {
    interface ASLModuleInfo {
        /** Module path (normalized) */
        readonly path: string;

        /** Module id */
        readonly mid: ASLModuleId;
    }

    interface ASLModuleRuntime {
        /** Path to module file */
        readonly path: string;

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
}