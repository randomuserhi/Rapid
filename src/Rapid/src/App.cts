import { RapidRuntime } from "./RapidRuntime.cjs";

// Host

const PORT = 3000;

const app = new RapidRuntime(["C:\\Users\\User\\Documents\\Git\\RapidRegistry\\Apps"], "C:\\Users\\User\\Documents\\Git\\RapidRegistry\\@types");

app.listen(PORT).then(() => {
    console.log(`Server running at http://localhost:${PORT}/`);
});