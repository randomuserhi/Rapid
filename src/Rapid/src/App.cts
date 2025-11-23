// Temporary test code for ASL

import { ASLEnvironment } from "./ASL/Runtime/ASLRuntime.cjs";

const env = new ASLEnvironment();

const test = "E:\\test.js";
const test2 = "E:\\test2.js";

const p = env.fetch(test);

setTimeout(() => {
    //registry.invalidate(registry.getMid(test2));
    //env.invalidate(registry.getMid(test2));
}, 1000);