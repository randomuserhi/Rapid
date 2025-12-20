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
        /**
         * Create a GET route for the current app.
         * 
         * @param url 
         * @param callback 
         */
        export function get(url: string, callback: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void): (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void;

        /**
         * 
         * @param method 
         * @param cb 
         */
        export function remove(method: "GET", cb: (match: PatternMatch, req: Http.IncomingMessage, res: Http.ServerResponse, next: unknown) => void): boolean;
    }
}