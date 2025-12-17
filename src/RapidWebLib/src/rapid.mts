import { ASLEnvironment, defaultImportHook, extname, fixASLPath, setASLBaseURL } from "/rapid/ASLRuntime.mjs";

const CHAR_FORWARD_SLASH = 47; /* / */

function getPckg(path: string) {
    const origin = window.location.origin;
    if (path.startsWith(origin)) path = path.slice(origin.length);
    
    let start = 0;
    let end = 0;
    let read = false;
    for (; end < path.length; ++end) {
        const code = path.charCodeAt(end);
        if (code !== CHAR_FORWARD_SLASH) {
            if (!read) start = end;
            read = true;
        } else if (read) {
            break;
        }
    }
    let baseURL = path.slice(start, end + 1);
    if (!baseURL.endsWith("/")) baseURL += "/";
    return baseURL;
}

/** Load rapid entry point */
function loadEntry(entry: string) {
    const baseURL = `${window.location.origin}/${getPckg(window.location.pathname)}`;

    const env = new ASLEnvironment();
    env.importHook = async (module, path) => {
        path = fixASLPath(path);

        if (!path.startsWith(".") && extname(path) === "") {
            // For non-relative imports with no extension,
            // check for rapid, standard library import

            // Resolve rapidlib paths:
            if (path.startsWith("rapid")) {
                return `/${path}.mjs`;
            }
        }

        return await defaultImportHook(module, path);
    };

    env.fetch(new URL(fixASLPath(entry), baseURL).toString());
}

interface RapidConfig {
    entry?: string;
}

setASLBaseURL(window.location.origin);

const rapid: RapidConfig = (window as any).rapid;
(window as any).rapid = undefined;

if (rapid !== undefined) {
    if (rapid.entry !== undefined && typeof rapid.entry === "string") {
        loadEntry(rapid.entry);
    }
}