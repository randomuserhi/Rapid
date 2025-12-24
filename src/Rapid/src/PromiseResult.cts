
/**
 * A result for a given request.
 * Can be checked if the result is available or if it errored.
 * 
 * This is preferred over Promise as handling uncaught exceptions in promises is
 * difficult to maintain.
 */
export class Result<T, ErrorType = any> {
    private static OK = Symbol("Result.OK");

    error: typeof Result<T, ErrorType>["OK"] | ErrorType;
    item: T;

    constructor(result?: T, error: Result<T, ErrorType>["error"] = Result.OK) {
        this.item = result!;
        this.error = error;
    }

    public ok() {
        return this.error === Result.OK;
    }
}

/**
 * Static resolve handler for `Request`s.
 */
function PromiseResultResolve<T, ErrorType = any>(resolve: (value: Result<T, ErrorType> | PromiseLike<Result<T, ErrorType>>) => void) {
    return (result: T | PromiseLike<T>) => {
        if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as PromiseLike<T>).then === "function") {
            // If result is PromiseLike, we have to .then it
            (result as PromiseLike<T>).then((result) => resolve(new Result<T, ErrorType>(result)));
        } else {
            resolve(new Result<T, ErrorType>(result as T));
        }
    };
}

/**
 * Creates a Promise that returns an ASLRequestResult object instead.
 * These promises never throw.
 */
export function PromiseResult<T, ErrorType = any>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: ErrorType) => void) => void): Promise<Result<T, ErrorType>> {
    return new Promise<Result<T, ErrorType>>((resolve, reject) => {
        executor(PromiseResultResolve(resolve), reject);
    }).catch(reason => new Result<T, ErrorType>(undefined, reason));
}

/**
 * Request type
 */
export type PromiseResult<T, ErrorType = any> = Promise<Result<T, ErrorType>>;