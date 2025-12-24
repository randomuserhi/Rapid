import { bind } from "../ArrowBind.cjs";
import { RapidApp } from "../RapidRuntime.cjs";

export { bind } from "../ArrowBind.cjs";
export type { RapidApp } from "../RapidRuntime.cjs";

import FileSync from "fs";
import Http from "http";
import Path from "path";
import { pipeline } from "stream/promises";
import type { ASLModuleRuntime } from "../ASL/ASLRuntime.cjs";
import { PatternMatch, Router } from "../Router.cjs";

/** TODO(randomuserhi): Move to some http utility module */
type RestMethod = "GET" | "POST";

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.svg': 'application/image/svg+xml'
} as const;

async function serve(path: string, res: Http.ServerResponse) {
    const extname: keyof typeof mimeTypes = Path.extname(path).toLowerCase() as any;
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    
    const stream = FileSync.createReadStream(path);
    await pipeline(stream, res);
}

function route(app: RapidApp, runtime: ASLModuleRuntime, method: RestMethod, path: string, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = app.httpRoutes.get(method);
    if (router === undefined) {
        router = new Router();
        app.httpRoutes.set(method, router);
    }
    
    router.add(path, cb);

    // Auto clear route when module is destructed
    runtime.onAbort(() => router.remove(cb));

    return cb;
}

function remove(app: RapidApp, method: RestMethod, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = app.httpRoutes.get(method);
    if (router === undefined) {
        router = new Router();
        app.httpRoutes.set(method, router);
    }

    return router.remove(cb);
}

// ASL import hook for module runtime 
function __linkASLRuntime(app: RapidApp, appExports: any, runtime: ASLModuleRuntime, exports: any) {
    return {
        ...exports,
        app: {
            serve,
            route: bind(route, app, runtime),
            ...appExports
        }
    };
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp, exports: any) {
    // Exports specific to the app
    const appExports = {
        name: app.pckgInfo.name,
        remove: bind(remove, app)
    };

    return {
        ...exports,
        __linkASLRuntime: bind(__linkASLRuntime, app, appExports)
    };
}