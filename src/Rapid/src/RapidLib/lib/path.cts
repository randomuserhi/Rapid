import type { RapidApp } from "../rapid.cjs";
import { bind } from "../rapid.cjs";

import File from "fs";
import Path from "path";

const fileExistsSync = (path: string) => File.existsSync(path);

function back(app: RapidApp, ...parts: string[]) {
    const {
        backBuildDir,
        backDir,
        flexBuildDir,
        flexDir
    } = app.pckgInfo;

    let resolvedPath = Path.join(backBuildDir, ...parts);

    if (fileExistsSync(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(backDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;

    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(flexDir, ...parts);
    return resolvedPath;
}

function front(app: RapidApp, ...parts: string[]) {
    const {
        frontBuildDir,
        frontDir,
        flexBuildDir,
        flexDir
    } = app.pckgInfo;

    let resolvedPath = Path.join(frontBuildDir, ...parts);

    if (fileExistsSync(resolvedPath)) return resolvedPath;
    resolvedPath = Path.join(frontDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;

    resolvedPath = Path.join(flexBuildDir, ...parts);
    if (fileExistsSync(resolvedPath)) return resolvedPath;
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