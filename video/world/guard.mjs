// 版の履歴の台本が書いてよい保管先かを決める（純粋な関数。Vite も MOYAI の本体も要らない）。
// 運営者の本物の保管先に、動画の世界を混ぜない。断る場合：
//   1 道が絶対の道でない
//   2 道に MOYAI という名前のフォルダが入っている（既定の保管先は Documents の下の MOYAI/）
//   3 運営者の状態フォルダの設定（settings.json）の保管先と重なる（同じ・中・外）
//   4 状態フォルダそのもの（の中・外）と重なる
//   5 中身のある保管先（空のフォルダか、無いフォルダだけ）
// 状態フォルダは MOYAI_STATE_DIR か、MOYAI の既定の場所（src/bridge/state.ts の resolveStateDir と同じ決め方）。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/** MOYAI の既定の状態フォルダ（src/bridge/state.ts と同じ決め方。ここに写したのは、この台本が Vite を通さずに断れるようにするため） */
export function stateDirOf(env = process.env, platform = process.platform) {
  if (env.MOYAI_STATE_DIR) return env.MOYAI_STATE_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "MOYAI", "state");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "MOYAI", "state");
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "moyai");
}

const norm = (p, platform) => {
  const r = resolve(p);
  return platform === "win32" ? r.toLowerCase() : r;
};
const within = (inner, outer, platform) => {
  const sp = platform === "win32" ? "\\" : sep;
  return inner === outer || inner.startsWith(outer.endsWith(sp) ? outer : outer + sp);
};

/** 状態フォルダの settings.json の保管先（読めなければ null） */
export function configuredRoot(stateDir) {
  try {
    const s = JSON.parse(readFileSync(join(stateDir, "settings.json"), "utf8"));
    return typeof s?.root === "string" && isAbsolute(s.root) ? s.root : null;
  } catch {
    return null;
  }
}

/**
 * @param {string | undefined} target  引数で受けた保管先
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [o]
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function checkStore(target, o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  if (typeof target !== "string" || target.trim() === "" || !isAbsolute(target)) return { ok: false, reason: "保管先は絶対の道で渡す（--store <道>）" };
  const path = resolve(target);
  const p = norm(path, platform);
  if (path.split(/[\\/]+/).some((s) => s.toLowerCase() === "moyai")) return { ok: false, reason: "道に MOYAI のフォルダが入っている。MOYAI の既定の保管先の形なので断る" };
  const state = stateDirOf(env, platform);
  const real = configuredRoot(state);
  if (real) {
    const r = norm(real, platform);
    if (within(p, r, platform) || within(r, p, platform)) return { ok: false, reason: "状態フォルダの設定の保管先（運営者の本物の保管先）と重なる。断る" };
  }
  const s = norm(state, platform);
  if (within(p, s, platform) || within(s, p, platform)) return { ok: false, reason: "MOYAI の状態フォルダと重なる。断る" };
  if (existsSync(path)) {
    if (!statSync(path).isDirectory()) return { ok: false, reason: "保管先がフォルダでない" };
    if (readdirSync(path).length > 0) return { ok: false, reason: "保管先が空でない。空のフォルダか、まだ無いフォルダだけに作る" };
  }
  return { ok: true, path };
}
