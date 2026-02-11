import { bind } from "../ArrowBind.cjs";
import { RapidApp } from "../RapidRuntime.cjs";

export { bind } from "../ArrowBind.cjs";
export { onProcessExit } from "../ExitHandler.cjs";
export type { RapidApp } from "../RapidRuntime.cjs";

import FileSync from "fs";
import File from "fs/promises";
import Http from "http";
import Path from "path";
import type Stream from "stream";
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
    try {
        const stats = await File.stat(path);
        if (stats.isDirectory()) {
            res.statusCode = 500;
            res.end("Is Directory");
            return;
        }
    } catch (err: any) {
        switch(err?.code) {
        case "ENOENT": {
            res.statusCode = 404;
            res.end("File not found");
            return;
        }
        default: throw err;
        }
    }

    const extname: keyof typeof mimeTypes = Path.extname(path).toLowerCase() as any;
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    const stream = FileSync.createReadStream(path);
    
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    // res.flushHeaders();
    
    try {
        await pipeline(stream, res);
    } catch(err: any) {
        switch(err?.code) {
        case "ERR_STREAM_PREMATURE_CLOSE": break;
        default: throw err;
        }
    }
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

function upgrade(app: RapidApp, runtime: ASLModuleRuntime, path: string, cb: (match: PatternMatch, req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, next: unknown) => void) {
    app.wsRoutes.add(path, cb);

    // Auto clear route when module is destructed
    runtime.onAbort(() => app.wsRoutes.remove(cb));

    return cb;
}

// ASL import hook for module runtime 
function __linkASLRuntime(app: RapidApp, appExports: any, runtime: ASLModuleRuntime, exports: any) {
    return {
        ...exports,
        app: {
            serve,
            route: bind(route, app, runtime),
            upgrade: bind(upgrade, app, runtime),
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