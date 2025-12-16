import { PackageBuilder, PackageRegistry, PackageInfo } from "./PackageBuilder-.cjs";

const registry = new PackageRegistry(["C:\\Users\\User\\Documents\\TestRegistry"]);
const builder = new PackageBuilder("C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");

builder.build(registry, PackageInfo.get(registry.findPckgSync("App")!));

/**import { RapidRuntime } from "./RapidRuntime.cjs";

const PORT = 3000;

const app = new RapidRuntime(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"], "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");
//const app = new RapidRuntime(["E:\\Git\\RapidRegistry\\Apps"], "E:\\Git\\RapidRegistry\\@types");

app.listen(PORT).then(() => {
    console.log(`Server running at http://localhost:${PORT}/`);
});*/