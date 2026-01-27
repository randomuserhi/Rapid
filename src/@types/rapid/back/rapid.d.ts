import Http from "http";

interface PatternMatch {
    /** */
    postfix: Pattern;

    /** */
    postfixURL: string;

    /** */
    variables: { [k: string]: string }
}

declare module "rapid" {
    /** 
     * Backend main application.
     */
    export namespace app {
        export type RestMethod = "GET" | "POST";

        /** 
         * App / package name 
         */
        export const name: string;

        /**
         * Serve a resource as a server response
         * 
         * @param path Path of resource to serve
         * @param res http response object
         */
        export function serve(path: string, res: Http.ServerResponse): Promise<void>;

        /**
         * Create a GET route for the current app.
         * 
         * @param url 
         * @param callback 
         */
        export function route(method: RestMethod, url: string, callback: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, url: URL, next: unknown) => void): (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, url: URL, next: unknown) => void;

        /**
         * Create an upgrade route for the current app.
         * 
         * @param url 
         * @param callback 
         */
        export function upgrade(url: string, cb: (match: PatternMatch, req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, next: unknown) => void): (match: PatternMatch, req: Http.IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, next: unknown) => void;

        /**
         * 
         * @param method 
         * @param cb 
         */
        export function remove(method: RestMethod, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, url: URL, next: unknown) => void): boolean;
    }

    /**
     * For a given function, creates a bound function that has the same body as the original function.
     * The this object of the bound function is associated with the specified object, and has the specified initial parameters.
     * 
     * This is used over `Function.prototype.bind` as it has arrow function semantics which optimize better.
     * It is also used over an inline arrow function as it doesnt capture unnecessary variables due to scoping.
     * 
     * @param func The function to bind
     * @param args Arguments to bind to the parameters of the function.
     */
    export function bind<A extends any[], B extends any[], R>(func: (...args: [...A, ...B]) => R, ...args: A): (...args: B) => R;

    /**
     * Calls a given callback when process terminates
     * 
     * @param cb 
     * @param options 
     */
    export function onProcessExit(cb: () => void, options?: { signal?: AbortSignal });
}