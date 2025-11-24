import Typescript from "typescript";
import ASLTranspiler from "./ASL/ASLTranspiler.cjs";

const tsConfig: Typescript.CompilerOptions = {
    module: Typescript.ModuleKind.ES2022,
    moduleResolution: Typescript.ModuleResolutionKind.NodeNext,
    rootDir: "./",
    outDir: "E:\\",
    lib: ["ES2022"],
    types: ["node"],
};

ASLTranspiler.transpileProgram(["E:\\test.ts"], tsConfig);