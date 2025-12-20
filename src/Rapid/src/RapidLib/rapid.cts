import type { RapidApp } from "../RapidRuntime.cjs";

export type { RapidApp } from "../RapidRuntime.cjs";

import Http from "http";
import { ASLModuleData } from "../ASL/ASLRuntime.cjs";
import { PatternMatch, Router } from "../Router.cjs";

function get(this: RapidApp, data: ASLModuleData, path: string, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.routes.get("GET");
    if (router === undefined) {
        router = new Router();
        this.routes.set("GET", router);
    }
    
    router.add(path, cb);
    data.abort.signal.addEventListener("abort", () => {
        router.remove(cb);
    });

    return cb;
}

function remove(this: RapidApp, method: "GET", cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void) {
    let router = this.routes.get("GET");
    if (router === undefined) {
        router = new Router();
        this.routes.set("GET", router);
    }

    return router.remove(cb);
}

export function link(app: RapidApp, data: ASLModuleData) {
    return {
        app: {
            get: get.bind(app, data),
            remove: remove.bind(app)
        }
    };
}