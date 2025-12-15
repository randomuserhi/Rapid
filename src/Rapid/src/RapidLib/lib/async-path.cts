import type { RapidApp } from "../rapid.cjs";

import File from "fs/promises";
import Path from "path";

const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

async function front(this: RapidApp, ...parts: string[]) {
    const {
        frontBuildDir,
        frontDir,
        flexBuildDir,
        flexDir
    } = this.pckgInfo;

    let resolvedPath = Path.join(frontBuildDir, ...parts);
    
    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(frontDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    
    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    
    throw new Error("Resource does not exist");
    
}

export function link(app: RapidApp) {
    return {
        front: front.bind(app)
    };
}