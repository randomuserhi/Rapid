export { };

interface ASL {
    abort: AbortSignal;
    ready: () => void;
}

declare global {
    const ASL: ASL;
}