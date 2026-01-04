import type { PackageInfo } from "./pckgManager";
export type { PackageConfig, PackageInfo } from "./pckgManager";

/**
 * Find a package
 * @param pckgName Name of package
 */
export async function findPckg(pckgName: string): Promise<PackageInfo | undefined>;