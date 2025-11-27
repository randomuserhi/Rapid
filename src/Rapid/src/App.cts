
import File from "fs/promises";
import Path from "path";
import { ASLEnvironment, registry as ASLRegistry } from "./ASL/ASLRuntime.cjs";
import { PackageManager, PackageRegistry } from "./PackageManager.cjs";

(async () => {

    //const registry = new PackageRegistry(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"]);
    //const pckgManager = new PackageManager(registry, "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");

    const registry = new PackageRegistry(["E:\\RapidRegistry"]);

    const environment = new ASLEnvironment();

    // Example runtime builder
    const pckgManager = new PackageManager(registry, "E:\\Git\\RapidRegistry\\@types");
    pckgManager.builder.onASLTranspiled = (path) => {
        ASLRegistry.invalidate(path);
    };

    pckgManager.watch("App", "1.0.0");
    pckgManager.watch("Library", "1.0.0");

    // Example environment setup + Builder
    {
        const pckg = await registry.get("App", "1.0.0");
        if (pckg === undefined) return;

        // environment variables
        const buildDir = Path.resolve(Path.join(pckg.baseDir, ".build"));
        const root = Path.join(pckg.baseDir, "back");
        const rootBuild = Path.join(pckg.baseDir, ".build", "back");
        const flex = Path.join(pckg.baseDir, "flex");
        const flexBuild = Path.join(pckg.baseDir, ".build", "flex");

        const fileExists = (path: string) => File.access(path, File.constants.R_OK).then(() => true).catch(() => false);

        environment.importHook = async (module, path) => {
            path = Path.normalize(path);

            if (path.startsWith(".")) {
                // relative import

                // Check if it is really relative
                if (await fileExists(path)) return path;

                const fullPath = Path.resolve(Path.join(module.dir, path));

                if (fullPath.startsWith(buildDir)) {
                    // If we are in build directory check non build directory
                    const relPath = Path.relative(buildDir, fullPath);
                    return Path.join(pckg.baseDir, relPath);
                } else {
                    // If we are in non build directory check build directory
                    const relPath = Path.relative(pckg.baseDir, fullPath);
                    return Path.join(buildDir, relPath);
                }
            } else {
                // Check if it is in root build folder first
                let p = Path.join(rootBuild, path);
                if (await fileExists(p)) return p;

                // Otherwise check flex build folder
                p = Path.join(flexBuild, path);
                if (await fileExists(p)) return p;

                // Otherwise check root folder
                p = Path.join(root, path);
                if (await fileExists(p)) return p;

                // Otherwise check flex folder
                p = Path.join(flex, path);
                if (await fileExists(p)) return p;

                // Check package path
                const parts = path.split(Path.sep);
                const pckg = parts[0];
                const version = parts[1];
                
                const pckgInfo = await registry.get(pckg, version);
                if (pckgInfo !== undefined) {
                    const pckgRoot = Path.join(pckgInfo.baseDir, "back");
                    const pckgRootBuild = Path.join(pckgInfo.baseDir, ".build", "back");
                    const pckgFlex = Path.join(pckgInfo.baseDir, "flex");
                    const pckgFlexBuild = Path.join(pckgInfo.baseDir, ".build", "flex");

                    path = Path.relative(Path.join(pckg, version), path);

                    // Check if it is in root build folder first
                    p = Path.join(pckgRootBuild, path);
                    if (await fileExists(p)) return p;

                    // Otherwise check flex build folder
                    p = Path.join(pckgFlexBuild, path);
                    if (await fileExists(p)) return p;

                    // Otherwise check root folder
                    p = Path.join(pckgRoot, path);
                    if (await fileExists(p)) return p;

                    // Otherwise check flex folder
                    p = Path.join(pckgFlex, path);
                    if (await fileExists(p)) return p;
                }
            }

            throw new Error(`Could not find: ${path}`);
        };

        environment.fetch(Path.join(pckg.baseDir, ".build", "back", "back.js"));
    }

})();