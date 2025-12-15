/**
 * Gets the filepath to a resource in the front directory for the current package.
 * 
 * Searches build directory first, then base directory, then the flex directory.
 * 
 * @param parts Parts that make up the path
 */
export function front(...parts: string[]): string;

/**
 * Gets the filepath to a resource in the base directory for the current package.
 * 
 * @param parts Parts that make up the path
 */
export function base(...parts: string[]): string;

