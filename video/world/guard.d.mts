// guard.mjs の型
export function stateDirOf(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string;
export function configuredRoot(stateDir: string): string | null;
export function checkStore(target: string | undefined, o?: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): { ok: true; path: string } | { ok: false; reason: string };
