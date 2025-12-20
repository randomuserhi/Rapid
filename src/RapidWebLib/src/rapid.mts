import { ASLEnvironment, ASLPath, defaultImportHook, registry, setASLBaseURL, setASLIsCaseSensitive } from "/rapid/ASLRuntime.mjs";

export const app = {
    name: ASLPath.pckgName(window.location.pathname)
};

// Setup ASL base URL
setASLBaseURL(window.location.origin);

// TODO(randomuserhi): Fetch request from backend whether it is case sensitive or not via a Get Request
//                     This must be awaited on as we cannot continue until we know if paths are case
//                     sensitive or not to prevent malforming the registry.
setASLIsCaseSensitive(false);

/** Load rapid entry point */
function loadEntry(entry: string) {
    const baseURL = `${window.location.origin}/${app.name}/`;

    const env = new ASLEnvironment();
    env.importHook = async (module, data, path) => {
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

        return await defaultImportHook(module, data, path);
    };

    env.fetch(new URL(ASLPath.fixASLExt(entry), baseURL).toString());

    // Try connecting to socket
    // TODO(randomuserhi): More sophisticated web socket API
    const ws = new WebSocket(`ws://${window.location.host}/rapid`);
    ws.onmessage = (ev => {
        const data: {
            pckg: string,
            route: string,
            body: any
        } = JSON.parse(ev.data);

        if (data.pckg !== "rapid") return;

        switch (data.route) {
        case "hotReload": {
            const paths = [];
            for (const path of data.body) {
                paths.push(new URL(path.route, window.location.origin).toString());
            }
            registry.invalidate(paths);
        } break;
        }
    });
}

// Load config and trigger entry point as required

interface RapidConfig {
    entry?: string;
}

const rapid: RapidConfig = (window as any).rapid;
if (rapid !== undefined) {
    if (rapid.entry !== undefined && typeof rapid.entry === "string") {
        loadEntry(rapid.entry);
    }
}