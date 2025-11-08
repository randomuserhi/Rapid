import { spawn } from "child_process";
import { cp, mkdir, rm } from 'fs/promises';
import path from "path";

console.log(process.argv);

const root = path.resolve(process.cwd());

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

try {
    console.log("\nDeleting build folders...");
    await rm("./build", { recursive: true, force: true });
    await rm("./src/Rapid/build", { recursive: true, force: true });
    await rm("./src/RapidLib/build", { recursive: true, force: true });

    await tsc(["-b", "./src/Rapid", "./src/RapidLib"], "Transpiling Typescript");

    console.log("\nCopying resources to build folder...");
    await mkdir("./build");

    await mkdir("./build/Rapid");
    await cp("./src/Rapid/build", "./build/Rapid", { recursive: true });

    await mkdir("./build/RapidLib");
    await cp("./src/RapidLib/build", "./build/RapidLib", { recursive: true });

    console.log("\nBuild complete!");
} catch (e) {
    console.error(`\nBuild failed: ${e}`);
} finally {
    process.exit(1);
}