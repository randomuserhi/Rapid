import type { RapidApp } from "../rapid.cjs";
import { bind } from "../rapid.cjs";

function findPckg(app: RapidApp, pckgName: string) {
    return app.runtime.packageRegistry.findPckgSync(pckgName);
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp, exports: any) {
    return {
        ...exports,
        findPckg: bind(findPckg, app)
    };
}