import type { RapidApp } from "../RapidRuntime.cjs";

export type { RapidApp } from "../RapidRuntime.cjs";

import Http from "http";
import type { ASLModuleRuntime } from "../ASL/ASLRuntime.cjs";
import { PatternMatch, Router } from "../Router.cjs";

/** TODO(randomuserhi): Move to some http utility module */
type RestMethod = "GET" | "POST";

function route(this: RapidApp, runtime: ASLModuleRuntime, method: RestMethod, path: string, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.httpRoutes.get(method);
    if (router === undefined) {
        router = new Router();
        this.httpRoutes.set(method, router);
    }
    
    router.add(path, cb);

    // Auto clear route when module is destructed
    runtime.onAbort(() => router.remove(cb));

    return cb;
}

function remove(this: RapidApp, method: RestMethod, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.httpRoutes.get(method);
    if (router === undefined) {
        router = new Router();
        this.httpRoutes.set(method, router);
    }

    return router.remove(cb);
}

// Cache bound functions after linking to app (used by ASLRuntime linker)
const __linkCache = {
    name: undefined! as string,
    remove
};

// ASL import hook for module runtime 
function __linkASLRuntime(this: RapidApp, runtime: ASLModuleRuntime) {
    return {
        app: {
            route: route.bind(this, runtime),
            ...__linkCache
        }
    };
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp, exports: any) {
    __linkCache.remove = remove.bind(app);
    __linkCache.name = app.pckgInfo.name;

    return {
        ...exports,
        __linkASLRuntime: __linkASLRuntime.bind(app)
    };
}