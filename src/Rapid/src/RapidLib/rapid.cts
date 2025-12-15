import type { RapidApp } from "../RapidRuntime.cjs";

export type { RapidApp } from "../RapidRuntime.cjs";

import Http from "http";

function get(this: RapidApp, path: string, cb: (req: Http.IncomingMessage, res: Http.ServerResponse) => void) {
    let group = this.routes.get("GET");
    if (group === undefined) {
        group = new Map();
        this.routes.set("GET", group);
    }
        
    group.set(path, {
        path,
        method: "GET",
        handler: cb
    });
}

export function link(app: RapidApp) {
    return {
        app: {
            get: get.bind(app)
        }
    };
}