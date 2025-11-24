import { transformAsync } from "@babel/core";
import File from "fs/promises";
import Path from "path";
import Typescript from "typescript";
import ASLBabelConfig from "./Transpiler/ASLBabel.config.cjs";

// TODO(randomuserhi): Comment & cleanup code => standardise errors
// TODO(randomuserhi): Concurrency checks => `transpile` and `transpileProgram` both have 
//                     concurrency issues if called on the same stuff, they need to wait for 
//                     previous transpilation to complete

export async function transpile(inputTsFile: string, outputTsFile: string, tsConfig: Typescript.CompilerOptions) {
    // Transpile typescript
    const input = await File.readFile(inputTsFile, "utf-8");

    const typescriptOutput = Typescript.transpileModule(input, {
        compilerOptions: tsConfig,
        fileName: Path.basename(inputTsFile),
        reportDiagnostics: true
    });

    const errors = typescriptOutput.diagnostics?.filter(
        d => d.category === Typescript.DiagnosticCategory.Error
    );

    if (errors && errors.length > 0) {
        const messages = errors.map(d => Typescript.flattenDiagnosticMessageText(d.messageText, "\n"));
        throw new Error(`TypeScript compilation errors:\n${messages.join("\n")}`);
    }

    // Transpile to ASL
    const aslOutput = await transformAsync(typescriptOutput.outputText, ASLBabelConfig);

    if (!aslOutput || !aslOutput.code) {
        throw new Error("Babel failed to produce output");
    }

    await File.writeFile(outputTsFile, aslOutput.code);
}

export async function transpileProgram(inputFiles: string[], tsConfig: Typescript.CompilerOptions) {
    const program = Typescript.createProgram(inputFiles, tsConfig);

    const emitResult = await new Promise<Typescript.EmitResult>((resolve, reject) => {
        program.emit(
            undefined,
            async (fileName, data) => {
                const extname = Path.extname(fileName);
                // Only handle `.js` output files and ignore `.cjs` and `.mjs`
                switch(extname) {
                case ".js": {
                    try {
                        const babelResult = await transformAsync(data, ASLBabelConfig);
                        if (!babelResult || !babelResult.code) throw new Error("Babel failed");

                        const dir = Path.dirname(fileName);
                        if (dir !== Path.parse(dir).root) {
                            await File.mkdir(dir, { recursive: true });
                        }
                        await File.writeFile(fileName, babelResult.code);
                    } catch (err) {
                        reject(err);
                    }
                } break;

                default: {
                    const dir = Path.dirname(fileName);
                    if (dir !== Path.parse(dir).root) {
                        await File.mkdir(dir, { recursive: true });
                    }
                    await File.writeFile(fileName, data);
                } break;
                }
            }
        );
    });

    // Check diagnostics
    const allDiagnostics = Typescript.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    if (allDiagnostics.length > 0) {
        const messages = allDiagnostics.map(d =>
            Typescript.flattenDiagnosticMessageText(d.messageText, "\n")
        );
        throw new Error(`TypeScript compilation errors:\n${messages.join("\n")}`);
    }
}

export default {
    transpile,
    transpileProgram
};