import { RapidRuntime } from "./RapidRuntime.cjs";

const PORT = 3000;

const app = new RapidRuntime(["E:\\Git\\RapidRegistry\\packages", "E:\\Git\\RapidRegistry\\apps", "E:\\Git\\RapidRegistry\\docuscripts"], "E:\\Git\\RapidRegistry\\rapid_modules");
// const app = new RapidRuntime(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\packages", "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\apps", "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\docuscripts"], "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\rapid_modules");

app.listen(PORT).then(() => {
    console.log(`Server running at http://localhost:${PORT}/`);
});