import type { RapidApp } from "../rapid.cjs";

import File from "fs/promises";
import Path from "path";

const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

async function back(this: RapidApp, ...parts: string[]) {
    const {
        backBuildDir,
        backDir,
        flexBuildDir,
        flexDir
    } = this.pckgInfo;

    let resolvedPath = Path.join(backBuildDir, ...parts);

    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(backDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;

    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    return resolvedPath;
}

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

// Rapid App hook
export function __linkRapidApp(app: RapidApp) {
    return {
        back: back.bind(app),
        front: front.bind(app),
        base: base.bind(app)
    };
}