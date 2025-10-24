import { execSync } from "child_process";
import path from "path";

console.log(process.argv);

const root = path.resolve(process.cwd());

function run(cmd: string, label: string) {
  console.log(`\nBuilding ${label}...`);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

try {
  run("npx tsc -p ./src/Server/tsconfig.json", "server");
  run("npx tsc -p ./src/ASL/Transpiler/tsconfig.json", "aslTranspiler");
  run("npx tsc -p ./src/ASL/Runtime/tsconfig.json", "aslRuntime");
  console.log("\nBuild complete!");
} catch {
  console.error("\nBuild failed.");
  process.exit(1);
}