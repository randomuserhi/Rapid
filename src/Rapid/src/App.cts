import { RapidRuntime } from "./RapidRuntime.cjs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import File from "fs/promises";
import { createInterface } from "readline";
import { cleanPackage } from "./PackageBuilder.cjs";
import Path from "path";
import chalk from "chalk";

async function fileStat(path: string) {
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

export let runtime: RapidRuntime;

(async () => {
    const argv = await yargs(hideBin(process.argv))
        .option("config", {
            type: "string",
            describe: "Path to config JSON file",
            default: "./config.json"
        })
        .option("lib", {
            type: "string",
            describe: "Path to library types",
            default: Path.join(Path.dirname(process.execPath), "./lib")
        })
        .option("packages", {
            type: "string",
            array: true,
            describe: "List of package file paths",
            demandOption: true,
        })
        .option("port", {
            alias: "p",
            type: "number",
            describe: "Server port",
            default: 3000,
        })
        .parse();

    if (await fileStat(argv.config) !== undefined) {
        const config = JSON.parse(argv.config);
        if (config.lib !== undefined && typeof config.lib === "string") {
            argv.lib = config.lib;
        }
        if (config.packages !== undefined && Array.isArray(config.packages)) {
            for (const value of config.packages) {
                if (typeof value === "string") {
                    argv.packages.push(value);
                } else {
                    console.log(`Invalid package list from config: '${argv.config}'`);
                    return;
                }
            }
        }
    }

    runtime = new RapidRuntime(argv.packages, argv.lib);

    const prefix = chalk.grey("[rapid]");

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: ""
    });
    rl.on("line", async (input) => {
        const [command, ...args] = input.trim().split(" ");

        // TODO(randomuserhi): Cleanup REPL implementation
        if (command === "init") {
            if (args.length === 0 || typeof args[0] !== "string") {
                console.log(`${prefix} init <package name>`);
            } else {
                const pckg = await runtime.packageRegistry.findPckg(args[0]);
                if (pckg !== undefined) {
                    await runtime.packageBuilder.init(runtime.packageRegistry, pckg, { forceSelf: true });
                    console.log(`${prefix} Initialized package '${pckg.name}'.`);
                } else {
                    console.log(`${prefix} Could not find package '${args[0]}'.`);
                }
            }
        } else if (command === "clean") {
            if (args.length === 0 || typeof args[0] !== "string") {
                console.log(`${prefix} clean <package name>`);
            } else {
                const pckg = await runtime.packageRegistry.findPckg(args[0]);
                if (pckg !== undefined) {
                    await cleanPackage(runtime.packageRegistry, pckg, { cleanConfigFiles: true });
                    console.log(`${prefix} Cleaned package '${pckg.name}'.`);
                } else {
                    console.log(`${prefix} Could not find package '${args[0]}'.`);
                }
            }
        } else if (command === "build") {
            if (args.length === 0 || typeof args[0] !== "string") {
                console.log(`${prefix} clean <package name>`);
            } else {
                const pckg = await runtime.packageRegistry.findPckg(args[0]);
                if (pckg !== undefined) {
                    await runtime.packageBuilder.build(runtime.packageRegistry, pckg);
                    console.log(`${prefix} Built package '${pckg.name}'.`);
                } else {
                    console.log(`${prefix} Could not find package '${args[0]}'.`);
                }
            }
        } else if (command === "build-all") {
            await runtime.buildAll();
            console.log(`${prefix} Finished.`);
        } else if (command === "clean-all") {
            await runtime.cleanAll();
            console.log(`${prefix} Finished.`);
        } else if (command === "start") {
            if (args.length === 0 || typeof args[0] !== "string") {
                console.log(`${prefix} start <package name>`);
            } else {
                const app = await runtime.loadApp(args[0]);
                if (app !== undefined) {
                    await runtime.loadEntry(app, true);
                    console.log(`${prefix} Started '${args[0]}'.`);
                } else {
                    console.log(`${prefix} Could not find package '${args[0]}'.`);
                }
            }
        }
    });
    
    runtime.listen(argv.port).then(() => {
        console.log(`${prefix} Server running at http://localhost:${argv.port}/`);
    });
})();