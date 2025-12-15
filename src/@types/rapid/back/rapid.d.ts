import Http from "http";

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
        export function get(url: string, callback: (req: Http.IncomingMessage, res: Http.ServerResponse) => void): void;
    }
}