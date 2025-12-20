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

    type __linkASLRuntime = (runtime: ASLModuleRuntime) => ASLModuleObject;

    const __ASL: ASLModuleRuntime;
}