import { ASLEnvironment, defaultImportHook, extname, setASLBaseURL } from "/rapid/ASLRuntime.mjs";

/** Load rapid entry point */
export function loadEntry(entry: string) {
    const origin = window.location.origin;
    const pckgName = window.location.pathname.split('/')[1];
    const pckgRoot = origin + "/" + pckgName + "/";

    setASLBaseURL(origin);

    const env = new ASLEnvironment();
    env.importHook = async (module, path) => {
        if (!path.startsWith(".") && extname(path) === "") {
            // For non-relative imports with no extension,
            // check for rapid, standard library import

            // Since module resolution is typically handled by unix paths, convert backslash to unix style slashes
            path = path.replace("\\", "/");

            // Resolve rapidlib paths:
            if (path.startsWith("rapid")) {
                return `/${path}.mjs`;
            }

            throw new Error(`Could not find: ${path}`);
        }

        return await defaultImportHook(module, path);
    };
    
    env.fetch(new URL(entry, pckgRoot).toString());
}