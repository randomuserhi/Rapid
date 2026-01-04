import type { RapidApp } from "../rapid.cjs";
import { bind } from "../rapid.cjs";

import File from "fs/promises";
import Path from "path";

const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

async function back(app: RapidApp, ...parts: string[]) {
    const {
        backBuildDir,
        backDir,
        flexBuildDir,
        flexDir
    } = app.pckgInfo;

    let resolvedPath = Path.join(backBuildDir, ...parts);

    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(backDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;

    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    return resolvedPath;
}

async function front(app: RapidApp, ...parts: string[]) {
    const {
        frontBuildDir,
        frontDir,
        flexBuildDir,
        flexDir
    } = app.pckgInfo;

    let resolvedPath = Path.join(frontBuildDir, ...parts);

    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(frontDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;

    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (await fileExists(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    return resolvedPath;
}

function base(app: RapidApp, ...parts: string[]) {
    const { baseDir } = app.pckgInfo;
    return Path.join(baseDir, ...parts);
}

// Rapid App hook
export function __linkRapidApp(app: RapidApp, exports: any) {
    return {
        ...exports,
        back: bind(back, app),
        front: bind(front, app),
        base: bind(base, app)
    };
}