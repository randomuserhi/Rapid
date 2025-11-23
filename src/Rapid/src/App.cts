// Temporary test code for ASL

import { ASLEnvironment, registry } from "./ASL/Runtime/ASLRuntime.cjs";

const env = new ASLEnvironment();

const test = "E:\\test.js";

env.fetch(test).then(() => console.log((registry as any).paths));