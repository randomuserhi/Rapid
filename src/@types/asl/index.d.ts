export { };

interface ASL {
    abort: AbortSignal;
    ready: () => void;
}

type ASLModuleObject = Record<PropertyKey, any>;

declare global {
    interface ASLModuleInfo {
        /** Module path (normalized) */
        readonly path: string;

        /** Module id */
        readonly mid: ASLModuleId;
    }

    interface ASLModuleRuntime {
        abort: AbortController;
    }

    type __linkASLRuntime = (module: ASLModuleInfo, runtime: ASLModuleRuntime) => ASLModuleObject;

    const __ASL: ASL;
}