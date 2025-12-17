import { RapidRuntime } from "./RapidRuntime.cjs";

const PORT = 3000;

const app = new RapidRuntime(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"], "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\lib");
//const app = new RapidRuntime(["E:\\Git\\RapidRegistry\\Apps"], "E:\\Git\\RapidRegistry\\lib");

app.listen(PORT).then(() => {
    console.log(`Server running at http://localhost:${PORT}/`);
});