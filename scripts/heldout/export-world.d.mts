// export-world.mjs の型（試験から呼ぶため）
import type { HeldoutWorld } from "../../tests/heldout/contract";
export function exportWorld(world: unknown, precisionIds: string[]): HeldoutWorld & { note: string; contractors: { id: string; name: string; from: string | null }[] };
