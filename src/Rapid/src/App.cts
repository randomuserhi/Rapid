// Temporary test code for ASL

import { ASLEnvironment, registry } from "./ASL/Runtime/ASLRuntime.cjs";

const env = new ASLEnvironment();

Promise.all([env.fetch("E:\\test.js")]).then(() => {
    console.log((registry as any).dependencies);
    console.log((registry as any).pending);
});