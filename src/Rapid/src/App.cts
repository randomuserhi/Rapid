// Temporary test code for ASL

import { ASLEnvironment, registry } from "./ASL/Runtime/ASLRuntime.cjs";

const env = new ASLEnvironment();

// const test = "E:\\test.js";
const test = "C:\\Users\\User\\Documents\\test.js";

Promise.all([env.fetch(test)]).then(() => {
    console.log((registry as any).dependencies);
    console.log((registry as any).pending);

    console.log(env.getArchetype());
    console.log(env.getArchetype(registry.getMid(test)));
});