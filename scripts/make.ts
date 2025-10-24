import { spawn } from "child_process";
import path from "path";
import { rm, mkdir, cp, copyFile } from 'fs/promises';

console.log(process.argv);

const root = path.resolve(process.cwd());

// TODO(randomuserhi): Better shell process -> this is giga slow, spawns a new process each time
//                                          -> should be able to create command buffers that submit to each child process
//                                          -> keep multiple child processes for parallel builds...

// TODO(randomuserhi): Relies on user having npx, in path -> should avoid this
//                     They should only need Node runtime

function run(cmd: string, args: string[], name: string) {
    return new Promise<void>((resolve, reject) => {
        console.log(`\n${name}...`);
        const p = spawn(cmd, args, { stdio: ['inherit', 'inherit', 'inherit'], shell: true });
        p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)));
    });
}

try {
    const tasks = [];
    tasks.push(run("npx", ["tsc", "-p", "./src/Server/tsconfig.json"], "server"));
    tasks.push(run("npx", ["tsc", "-p", "./src/ASL/Transpiler/tsconfig.json"], "aslTranspiler"));
    tasks.push(run("npx", ["tsc", "-p", "./src/ASL/Runtime/tsconfig.json"], "aslRuntime"));
    tasks.push(run("npx", ["tsc", "-p", "./src/Web/tsconfig.json"], "web"));
    Promise.all(tasks);

    console.log("\nDeleting build folder...");
    await rm("./build", { recursive: true, force: true });

    console.log("\nCopying resources to build folder...");
    await mkdir("./build");
    await cp("./src/Server/build", "./build", { recursive: true });
    await cp("./src/ASL/Runtime/build", "./build", { recursive: true });
    await cp("./src/Web/build", "./build", { recursive: true });

    /*
    const src = 'src/Web/index.html';
    const destDir = 'build';
    const dest = path.join(destDir, path.basename(src));
    */

    await copyFile("./src/Web/index.html", "./build/index.html");
    await copyFile("./src/Web/default.css", "./build/default.css");

    console.log("\nBuild complete!");
} catch (e) {
    console.error(`\nBuild failed: ${e}`);
} finally {
    process.exit(1);
}