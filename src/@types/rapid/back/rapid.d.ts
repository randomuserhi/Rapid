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
        export function route(method: RestMethod, url: string, callback: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void): (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void;

        /**
         * 
         * @param method 
         * @param cb 
         */
        export function remove(method: RestMethod, cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void): boolean;
    }
}