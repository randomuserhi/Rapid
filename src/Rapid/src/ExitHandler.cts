const cleanupJobs = new Set<() => void>();

export function onProcessExit(cb: () => void, options?: { signal?: AbortSignal }) {
    cleanupJobs.add(cb);
    options?.signal?.addEventListener("abort", () => {
        cleanupJobs.delete(cb);
    });
}

async function exit(code: number) {
    const jobs = [];
    for (const job of cleanupJobs) {
        jobs.push(job());
    }
    await Promise.allSettled(jobs);

    process.exit(code);
}

process.on('SIGINT', () => {
    exit(0);
});

process.on('SIGTERM', () => {
    exit(0);
});

process.on('uncaughtException', (err) => {
    console.error(err);
    exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(reason);
    exit(1);
});