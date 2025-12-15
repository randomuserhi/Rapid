import type { RapidApp } from "../rapid.cjs";

import File from "fs";
import Path from "path";

const fileExistsSync = (path: string) => File.existsSync(path);

function front(this: RapidApp, ...parts: string[]) {
    const {
        frontBuildDir,
        frontDir,
        flexBuildDir,
        flexDir
    } = this.pckgInfo;

    let resolvedPath = Path.join(frontBuildDir, ...parts);
    
    if (fileExistsSync(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(frontDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;
    
    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;
    
    throw new Error("Resource does not exist");
    
}

export function link(app: RapidApp) {
    return {
        front: front.bind(app)
    };
}