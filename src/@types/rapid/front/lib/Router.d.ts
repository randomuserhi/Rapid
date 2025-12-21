export interface PatternMatch {
    /** */
    postfix: Pattern;

    /** */
    postfixURL: string;

    /** */
    variables: { [k: string]: string }
}

/** Generator that produces tokens over a path pattern */
export function pathTokens(pattern: string): Generator<Token, void, unknown>;

export class Pattern {
    public readonly tokens: Token[];

    constructor(pattern: string | Token[]);

    public match(other: Pattern): undefined | PatternMatch;
}

type RouterCallback<Args extends any[]> = (match: PatternMatch, ...args: Args) => void | typeof Router["NEXT"];

export class Router<Args extends any[]> {
    public static NEXT: symbol;
    public static NO_MATCH: symbol;

    private routes: Map<RouterCallback<Args>, Pattern>;

    public add(path: string, callback: RouterCallback<Args>): RouterCallback<Args>;

    public remove(callback: RouterCallback<Args>): boolean;

    /** Matches in the order patterns are registered. */
    public async match(path: string, ...args: Args): Promise<symbol | void>;
}