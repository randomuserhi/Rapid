import Chokidar from "chokidar"
import File from "fs/promises"
import Typescript from "typescript"
import Path from "path"
import ASLBabelConfig from "./ASL/Transpiler/ASLBabel.config.cjs";
import { transformAsync } from "@babel/core";

// TODO(randomuserhi): Fix the below diagnostic functions for typescript errors

const formatHost: Typescript.FormatDiagnosticsHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: Typescript.sys.getCurrentDirectory,
    getNewLine: () => Typescript.sys.newLine
};

function reportDiagnostic(diagnostic: Typescript.Diagnostic) {
    //console.error("Error", diagnostic.code, ":", Typescript.flattenDiagnosticMessageText(diagnostic.messageText, formatHost.getNewLine()));
}

function reportSolutionStatusChanged(diagnostic: Typescript.Diagnostic) {
    //console.info(Typescript.formatDiagnostic(diagnostic, formatHost));
}

function reportWatchStatusChanged(diagnostic: Typescript.Diagnostic) {
    //console.info(Typescript.formatDiagnostic(diagnostic, formatHost));
}

async function pathStat(path: string) {
    try {
        const stats = await File.stat(path);
        return stats;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return undefined;
        }
        throw err; // real unexpected error
    }
}

export class PackageManager {
    private host: Typescript.SolutionBuilderWithWatchHost<Typescript.SemanticDiagnosticsBuilderProgram> = undefined!;

    private builder: Typescript.SolutionBuilder<Typescript.SemanticDiagnosticsBuilderProgram> = undefined!;

    constructor(directories: string[]) {
        this.initialize(directories);
    }

    private async initialize(directories: string[]) {
        const configs = [];
        const rapidPaths: string[] = [];

        // Setup directories that make up the package registry
        for (const dir of directories) {
            const rapidPath = Path.join(dir, ".rapid/");
            rapidPaths.push(rapidPath);

            // Find tsconfig for the directory
            // Should be located in `.rapid/tsconfig.json`
            const tsconfigPath = Path.join(rapidPath, "tsconfig.json");
            const tsconfigStat = await pathStat(tsconfigPath);
            if (tsconfigStat === undefined) {
                // tsconfig does not exist, create it
                await File.mkdir(rapidPath, { recursive: true });

                // Iterate all directories with a depth of 2
                // Structure goes Package/Version

                const references: { path: string }[] = [];
                for (const packageEntry of await File.readdir(dir, { withFileTypes: true })) {
                    if (!packageEntry.isDirectory()) continue;
                    for (const versionEntry of await File.readdir(Path.join(dir, packageEntry.name), { withFileTypes: true })) {
                        if (!versionEntry.isDirectory()) continue;

                        // Check if its a valid package (contains a tsconfig.json)
                        const packageTsconfig = await pathStat(Path.join(versionEntry.parentPath, versionEntry.name, "tsconfig.json"));
                        if (packageTsconfig === undefined || !packageTsconfig.isFile()) continue;

                        references.push({
                            path: Path.join("../", packageEntry.name, versionEntry.name, "tsconfig.json")
                        });
                    }
                }

                // Create tsconfig
                const config: {
                    compilerOptions?: Typescript.CompilerOptions;
                    references?: Typescript.ProjectReference[];
                } = {
                    compilerOptions: {
                        composite: true,
                        tsBuildInfoFile: "./.tsbuildinfo"
                    },
                    references
                };

                await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));

            } else if (!tsconfigStat.isFile()) {
                console.warn(`'.rapid/tsconfig.json' exists but expected a file instead of a folder. Skipping...`);
                continue;
            }

            configs.push(tsconfigPath);
        }

        // Start chokidar to watch for new packages being created
        const watcher = Chokidar.watch(directories, {
            depth: 3,
            awaitWriteFinish: true,
            ignoreInitial: true
        });
        watcher.on("all", async (event, path) => {
            // Find which directory this path belongs to
            const dirIndex = directories.findIndex(dir => path.startsWith(Path.resolve(dir)));
            if (dirIndex < 0) return; // path outside roots (shouldn't happen)
            const dir = directories[dirIndex];
            const rapidPath = rapidPaths[dirIndex];

            const relativePath = Path.relative(Path.resolve(dir), Path.resolve(path));
            const depth = relativePath.split(Path.sep).filter(Boolean).length;

            if (depth === 3) {
                // File within a package was changed

                const basename = Path.basename(path);

                switch (basename) {
                    case "rapid.config.json": {
                        // If the file was a config file, generate package content etc...

                        // TODO(randomuserhi): Manage dependencies
                        // TODO(randomuserhi): Create required tsconfigs for `back`, `front`, `flex`
                    } break;
                    case "tsconfig.json": {
                        // If the file was the tsconfig, we add it to our build list on creation, and remove it on deletion

                        const tsconfigPath = Path.join(rapidPath, "tsconfig.json");
                        const config: {
                            compilerOptions?: Typescript.CompilerOptions;
                            references?: Typescript.ProjectReference[];
                        } = JSON.parse(await File.readFile(tsconfigPath, "utf-8"));

                        if (config.references === undefined) {
                            config.references = [];
                        }

                        switch (event) {
                            case "add": {
                                if (!config.references.some(ref => Path.resolve(ref.path) === Path.resolve(relativePath))) {
                                    config.references.push({
                                        path: Path.join("../", relativePath)
                                    });
                                }
                            } break;
                            case "unlink": {
                                const refIndex = config.references.findIndex(ref => Path.resolve(ref.path) === Path.resolve(relativePath));
                                if (refIndex > -1) {
                                    config.references.splice(refIndex, 1);
                                }
                            } break;
                        }

                        await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));
                    } break;
                }
            } else if (event === "unlinkDir") {
                // Directory containing packages was deleted, remove all paths that begin with the path prefix from our build list

                const tsconfigPath = Path.join(rapidPath, "tsconfig.json");
                const config: {
                    compilerOptions?: Typescript.CompilerOptions;
                    references?: Typescript.ProjectReference[];
                } = JSON.parse(await File.readFile(tsconfigPath, "utf-8"));

                if (config.references === undefined) {
                    config.references = [];
                }

                config.references = config.references.filter(ref => !ref.path.startsWith(Path.join("../", relativePath)))

                await File.writeFile(tsconfigPath, JSON.stringify(config, null, 2));
            }
        });

        // Start the typescript compiler

        this.host = Typescript.createSolutionBuilderWithWatchHost(
            Typescript.sys,
            Typescript.createSemanticDiagnosticsBuilderProgram,
            reportDiagnostic,
            reportSolutionStatusChanged,
            reportWatchStatusChanged
        );

        // Overwrite behaviour for babel transpilation of asl files
        const origWriteFile = this.host.writeFile;
        this.host.writeFile = async (fileName, data) => {
            const extname = Path.extname(fileName);
            // Only handle `.js` output files and ignore `.cjs` and `.mjs`
            switch (extname) {
                case ".js": {
                    const babelResult = await transformAsync(data, ASLBabelConfig);
                    if (!babelResult || !babelResult.code) {
                        // Error in transpilation, skip
                        return;
                    }

                    const dir = Path.dirname(fileName);
                    if (dir !== Path.parse(dir).root) {
                        await File.mkdir(dir, { recursive: true });
                    }
                    await File.writeFile(fileName, babelResult.code);
                } break;

                default: {
                    origWriteFile?.(fileName, data);
                } break;
            }
        };

        this.builder = Typescript.createSolutionBuilderWithWatch(this.host, configs, {});

        this.builder.build();

        // Cleanup on program exit
        const cleanup = () => {
            watcher.close();
        }

        process.on("exit", () => {
            cleanup();
            process.exit(0);
        });

        process.on("SIGINT", () => {
            cleanup();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            cleanup();
            process.exit(0);
        });
    }
}