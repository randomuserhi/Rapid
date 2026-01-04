import type { RapidApp } from "../rapid.cjs";
import { bind } from "../rapid.cjs";

async function findPckg(app: RapidApp, pckgName: string) {
    return await app.runtime.packageRegistry.findPckg(pckgName);
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp, exports: any) {
    return {
        ...exports,
        findPckg: bind(findPckg, app)
    };
}