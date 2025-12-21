import { RapidRuntime } from "./RapidRuntime.cjs";

const PORT = 3000;

const app = new RapidRuntime(["E:\\Git\\RapidRegistry\\packages"], "E:\\Git\\RapidRegistry\\lib");

app.listen(PORT).then(() => {
    console.log(`Server running at http://localhost:${PORT}/`);
});