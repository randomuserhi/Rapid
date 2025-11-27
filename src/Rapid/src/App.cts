
// import { PackageManager } from "./PackageManager.cjs";
import { PackageManager, PackageRegistry } from "./PackageManager2.cjs";

(async () => {

    //const registry = new PackageRegistry(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"]);
    //const pckgManager = new PackageManager(registry, "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");

    const registry = new PackageRegistry(["E:\\RapidRegistry"]);
    const pckgManager = new PackageManager(registry, "E:\\Git\\RapidRegistry\\@types");

    pckgManager.make("Library", "1.0.0");
    pckgManager.make("App", "1.0.0");

})();

// const pb = new PackageManager(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"], "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");
// const pb = new PackageManager(["E:\\Git\\RapidRegistry\\Apps"], "E:\\Git\\RapidRegistry\\@types");