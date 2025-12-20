import type { RapidApp } from "../RapidRuntime.cjs";

export type { RapidApp } from "../RapidRuntime.cjs";

import Http from "http";
import type { ASLModuleRuntime } from "../ASL/ASLRuntime.cjs";
import { PatternMatch, Router } from "../Router.cjs";

function get(this: RapidApp, runtime: ASLModuleRuntime, path: string, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.httpRoutes.get("GET");
    if (router === undefined) {
        router = new Router();
        this.httpRoutes.set("GET", router);
    }
    
    router.add(path, cb);
    runtime.onAbort(() => router.remove(cb));

    return cb;
}

function remove(this: RapidApp, method: "GET", cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.httpRoutes.get(method);
    if (router === undefined) {
        router = new Router();
        this.httpRoutes.set(method, router);
    }

    return router.remove(cb);
}

const __linkCache = {
    remove
};

// ASL import hook for module runtime 
function __linkASLRuntime(this: RapidApp, runtime: ASLModuleRuntime) {
    return {
        app: {
            get: get.bind(this, runtime),
            ...__linkCache
        }
    };
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp) {
    __linkCache.remove = remove.bind(app);

    return {
        __linkASLRuntime: __linkASLRuntime.bind(app)
    };
}