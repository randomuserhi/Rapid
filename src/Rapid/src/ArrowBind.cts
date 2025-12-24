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
export function bind<A extends any[], B extends any[], R>(func: (...args: [...A, ...B]) => R, ...args: A): (...args: B) => R {
    return (...remaining: B) => func(...args, ...remaining);
}