// 公開の台帳の受け口（Cloudflare Workers の入口）。処理は handler.ts、デプロイの手順は services/ledger-intake/README.md。
// 束縛：秘密 GITHUB_TOKEN・変数 LEDGER_REPO・KV INTAKE_KV（wrangler.jsonc）。GitHub への fetch は Workers の fetch。
import { handleRequest, type IntakeEnv } from "./handler";
import { packOf } from "./packs";

export default {
  fetch(req: Request, env: IntakeEnv): Promise<Response> {
    return handleRequest(req, env, { fetch: (u, i) => fetch(u, i), now: () => Date.now(), packOf });
  },
};
