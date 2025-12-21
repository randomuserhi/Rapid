import { ASLEnvironment, ASLPath, defaultImportHook, getASLBaseURL, registry, setASLBaseURL, setASLIsCaseSensitive } from "/rapid/ASLRuntime.mjs";

/**
 * App object for rapid standard library
 */
class App {
    readonly name: string;

    constructor() {
        this.name = ASLPath.first(window.location.pathname);
    }
}

// Prepare standard library "app" object
export const app = new App();

const APP_LINK_HOOK = "__linkRapidApp";