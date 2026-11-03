// hash.mjs の型（試験から呼ぶため）
export function bundleFiles(dir: string): string[];
export function bundleHash(dir: string): { bundle: string; files: { path: string; sha256: string; bytes: number }[] };
