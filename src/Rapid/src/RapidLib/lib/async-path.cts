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
    return resolvedPath;
}

function base(this: RapidApp, ...parts: string[]) {
    const { baseDir } = this.pckgInfo;
    return Path.join(baseDir, ...parts);
}

export function __linkRapidApp(app: RapidApp) {
    return {
        front: front.bind(app),
        base: base.bind(app)
    };
}