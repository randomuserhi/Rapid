const CHAR_FORWARD_SLASH = 47; /* / */
const CHAR_COLON = 58; /* : */

interface Token {
    type: "variable" | "wildcard" | "token";
    value: string;
}

export interface PatternMatch {
    /** */
    postfix: Pattern;

    /** */
    postfixURL: string;

    /** */
    variables: { [k: string]: string }
}

/** Generator that produces tokens over a path pattern */
export function *pathTokens(pattern: string): Generator<Token, void, unknown> {
    // implicit "/" gets inserted at the front
    if (pattern.length === 0) pattern = "/";
    else if (pattern !== "*" && pattern.codePointAt(0) !== CHAR_FORWARD_SLASH) pattern = "/" + pattern;

    // Handle special cases
    if (pattern === "*") {
        yield { type: "wildcard", value: "*" };
        return;
    } else if (pattern === "/") {
        yield { type: "token", value: "" };
        return;
    }

    // Parse path to generate tokens
    let validCharacters = false;
    let type: Token["type"] = "token";
    let start = -1;
    let end = 0;
    for (; end < pattern.length; ++end) {
        const code = pattern.codePointAt(end);
        if (code !== CHAR_FORWARD_SLASH) {
            if (!validCharacters) {
                if (code === CHAR_COLON) type = "variable";
                start = end;
            }
            validCharacters = true;
        } else {
            const value = pattern.slice(start, end);

            // Early stop on wildcard
            if (value === "*") {
                yield { type: "wildcard", value };
                return;
            }

            // Push new token
            yield { type, value };

            // Reset
            validCharacters = false;
            type = "token";
            start = -1;
        }
    }
    // Push last token
    if (start !== -1) {
        const value = pattern.slice(start, end);

        if (value === "*") {
            yield { type: "wildcard", value };
        } else {
            yield { type, value };
        }
    } else {
        yield { type: "token", value: "" };
    }
}

export class Pattern {
    public readonly tokens: Token[];

    constructor(pattern: string | Token[]) {
        if (typeof pattern === "string") {
            this.tokens = [...pathTokens(pattern)];
        } else {
            this.tokens = pattern;
        }
    }

    public match(other: Pattern): undefined | PatternMatch {
        if (this.tokens.length > other.tokens.length) {
            // If the pattern is larger than the route, it can never match it
            return undefined;
        } else if (this.tokens[this.tokens.length - 1].type !== "wildcard" && other.tokens.length !== this.tokens.length) {
            // If this pattern does not end in a wildcard, then it can never match another of different length
            return undefined;
        }

        const match: PatternMatch = {
            variables: {}
        } as PatternMatch;

        let postfixStart = 0;
        for (; postfixStart < other.tokens.length; ++postfixStart) {
            const token = other.tokens[postfixStart];

            if (token.type !== "token") throw new Error("Invalid route. All parts should be tokens.");

            const pToken = this.tokens[postfixStart];

            if (pToken.type === "token" && pToken.value !== token.value) {
                // No match
                return undefined;
            }

            if (pToken.type === "variable") {
                const name = pToken.value.slice(1);
                if (name.length > 0) {
                    match.variables[name] = token.value;
                }
            }

            if (pToken.type === "wildcard") {
                // We hit a wildcard, pattern must match from this point onwards
                break;
            } 
        }

        match.postfixURL = "";
        const tokens: Token[] = [];
        for (; postfixStart < other.tokens.length; ++postfixStart) {
            const token = other.tokens[postfixStart];
            tokens.push({ ...token });

            match.postfixURL += token.value;
            if (postfixStart !== other.tokens.length - 1) match.postfixURL += "/";
        }
        if (tokens.length > 0) {
            match.postfix = new Pattern(tokens);
            
            // implicit "/" gets inserted at the front of url
            if (match.postfixURL.length === 0) match.postfixURL = "/";
            else if (match.postfixURL.codePointAt(0) !== CHAR_FORWARD_SLASH) match.postfixURL = "/" + match.postfixURL;
        } else {
            match.postfix = undefined!;
            match.postfixURL = undefined!;
        }

        return match;
    }
}

type RouterCallback<Args extends any[]> = (match: PatternMatch, ...args: Args) => void | typeof Router["NEXT"];

export class Router<Args extends any[]> {
    public static NEXT = Symbol("Router.NEXT");
    public static NO_MATCH = Symbol("Router.NO_MATCH");

    private routes = new Map<RouterCallback<Args>, Pattern>();

    public add(path: string, callback: RouterCallback<Args>) {
        this.routes.set(callback, new Pattern(path));

        return callback;
    }

    public remove(callback: RouterCallback<Args>) {
        return this.routes.delete(callback);
    }

    /** Matches in the order patterns are registered. */
    public async match(path: string, ...args: Args) {
        const route = new Pattern(path);

        let next: void | typeof Router["NO_MATCH"] | typeof Router["NEXT"] = Router.NO_MATCH;

        for (const [callback, pattern] of this.routes) {
            const match = pattern.match(route);
            if (match !== undefined) {
                next = await callback(match, ...args);
                if (next !== Router.NEXT) break;
            }
        }

        return next;
    }
}