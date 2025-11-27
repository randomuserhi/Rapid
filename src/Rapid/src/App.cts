
import { PackageManager, PackageRegistry } from "./PackageManager.cjs";

(async () => {

    //const registry = new PackageRegistry(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"]);
    //const pckgManager = new PackageManager(registry, "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");

    const registry = new PackageRegistry(["E:\\RapidRegistry"]);
    const pckgManager = new PackageManager(registry, "E:\\Git\\RapidRegistry\\@types");

    pckgManager.make("Library", "1.0.0");
    pckgManager.make("App", "1.0.0");

    pckgManager.watch("App", "1.0.0");
    pckgManager.watch("Library", "1.0.0");

})();