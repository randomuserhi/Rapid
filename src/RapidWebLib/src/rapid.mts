import { ASLEnvironment, ASLPath, defaultImportHook, setASLBaseURL, setASLIsCaseSensitive } from "/rapid/ASLRuntime.mjs";

// Setup ASL base URL
setASLBaseURL(window.location.origin);

// TODO(randomuserhi): Fetch request from backend whether it is case sensitive or not via a Get Request
//                     This must be awaited on as we cannot continue until we know if paths are case
//                     sensitive or not to prevent malforming the registry.
setASLIsCaseSensitive(false);

/** Load rapid entry point */
function loadEntry(entry: string) {
    const baseURL = `${window.location.origin}/${ASLPath.pckgName(window.location.pathname)}/`;

    const env = new ASLEnvironment();
    env.importHook = async (module, path) => {
        path = ASLPath.fixASLExt(path);

        if (!path.startsWith(".")) {
            // Resolve non-relative imports

            // Ensure path forms a valid url, it must start with a `/`
            if (ASLPath.startsWithSeparator(path)) path = "/" + path;

            // Resolve rapidlib paths
            if (ASLPath.pckgName(path) === "rapid") {
                // Amend extension if none is given, all rapidlib paths are .mjs scripts
                // so we can accept no extension and implicitly add extension
                if (!ASLPath.endsWithSeparator(path) && ASLPath.extname(path) === "") path += ".mjs";
            }
        }

        return await defaultImportHook(module, path);
    };

    env.fetch(new URL(ASLPath.fixASLExt(entry), baseURL).toString());
}

interface RapidConfig {
    entry?: string;
}

const rapid: RapidConfig = (window as any).rapid;
(window as any).rapid = undefined;

if (rapid !== undefined) {
    if (rapid.entry !== undefined && typeof rapid.entry === "string") {
        loadEntry(rapid.entry);
    }
}