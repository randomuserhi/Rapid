import { spawn } from "child_process";
import { cp, mkdir, rm, stat } from 'fs/promises';
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// TODO(randomuserhi): Relies on user having node, in path -> should avoid this
//                     They should only need Node runtime

function tsc(args: string[], name: string) {
    return new Promise<void>((resolve, reject) => {
        console.log(`\n${name}...`);
        const p = spawn("node", ["./node_modules/typescript/bin/tsc", ...args], { stdio: "pipe" });

        p.stdout.on('data', data => process.stdout.write(`[${name}] ${data}`));
        p.stderr.on('data', data => process.stderr.write(`[${name}] ${data}`));

        p.on('error', reject);
        p.on('exit', code =>
            code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))
        );
    });
}

function run(cmd: string, args: string[], name: string) {
    return new Promise<void>((resolve, reject) => {
        console.log(`\n${name}...`);
        const p = spawn(cmd, args, { stdio: "inherit" });

        p.on("error", reject);
        p.on("exit", code =>
            code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`))
        );
    });
}

async function buildSEA() {
    console.log("\nGenerating SEA exec...");

    await run("node", [
        "--build-sea",
        "./scripts/sea-config.json"
    ], "SEA config");

    await cp("./scripts/sea-package.json", "./dist/package.json");

    // TODO(randomuserhi): Run npm install on dist
}

try {
    console.log("\nDeleting build folders...");
    await rm("./build", { recursive: true, force: true });
    await rm("./src/Rapid/build", { recursive: true, force: true });
    await rm("./src/RapidWebLib/build", { recursive: true, force: true });

    await tsc(["-b", "./src/Rapid", "./src/RapidWebLib"], "Transpiling Typescript");

    console.log("\nCopying resources to build folder...");
    await mkdir("./build");

    await mkdir("./build/Rapid");
    await cp("./src/Rapid/build", "./build/Rapid", { recursive: true });

    await mkdir("./build/Rapid/RapidWebLib");
    await cp("./src/RapidWebLib/build", "./build/Rapid/RapidWebLib", { recursive: true });

    console.log("\nGenerate Registry Types...");

    const typesFolder = "./build/lib";
    await rm(typesFolder, { recursive: true, force: true });

    await mkdir(typesFolder);
    await cp("./src/@types", typesFolder, { recursive: true });

    const typeFilter = async (source: string, destination: string) => { 
        const info = await stat(source);
        if (info.isDirectory()) {
            return true;
        }
        return source.endsWith(".d.ts");
    };

    await mkdir(path.join(typesFolder, "node"));
    await cp("./node_modules/@types/node", path.join(typesFolder, "node"), { recursive: true });
    await cp("./node_modules/@types/ws", path.join(typesFolder, "ws"), { recursive: true });
    await cp("./node_modules/@types/better-sqlite3", path.join(typesFolder, "better-sqlite3"), { recursive: true });
    await cp("./node_modules/date-fns", path.join(typesFolder, "date-fns"), { recursive: true, filter: typeFilter });
    await cp("./node_modules/node-cron/dist/node-cron.d.ts", path.join(typesFolder, "node-cron/node-cron.d.ts"));

    // console.log("\nPreparing SEA dist...");
    // await mkdir("./dist", { recursive: true });
    // await rm("./dist/lib", { recursive: true, force: true });
    // await rm("./dist/Rapid", { recursive: true, force: true });
    // await rm("./dist/rapid.exe", { force: true });

    // // NOTE(randomuserhi): requires Node v26+
    // await buildSEA();
    
    // await cp(typesFolder, "./dist/lib", { recursive: true });
    // await cp("./build/Rapid", "./dist/Rapid", { recursive: true });

    console.log("\nBuild complete!");
} catch (e) {
    console.error(`\nBuild failed: ${e}`);
    process.exit(1);
}

process.exit(0);