// moyai start の引数。
import { DEFAULT_PORT } from "../bridge/server";

export interface StartArgs {
  port: number;
  open: boolean;
}

/** start の引数を読む。読めなければ null。 */
export function parseStartArgs(argv: string[]): StartArgs | null {
  let port = DEFAULT_PORT;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-open") open = false;
    else if (a === "--port" || a?.startsWith("--port=")) {
      const v = a === "--port" ? argv[++i] : a.slice("--port=".length);
      if (!v || !/^\d{1,5}$/.test(v)) return null;
      port = Number(v);
      if (port < 1 || port > 65535) return null;
    } else return null;
  }
  return { port, open };
}
