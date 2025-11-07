// Temporary test code for ASL

import { ASLEnvironment } from "./ASL/Runtime/ASLRuntime.cjs";

const env = new ASLEnvironment();

Promise.all([env.fetch("C:\\Users\\User\\Documents\\test.js")]);