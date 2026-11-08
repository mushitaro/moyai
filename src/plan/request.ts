// 頼みと受け取り（運営者の決定「マジックリンクで、クリックしたら署名の鎖が両方に入る」、監査 B1・B2。docs/plan.md §7）。
// ① 頼む人が「署名して渡す」を押すと、頼む人の鍵で署名した「頼み」を保管先の計画のフォルダ（requests/）に置く。
//    中身は計画・版・中身のハッシュ・頼むこと（承認か編集か）・宛先・使い捨ての合言葉の SHA-256。
// ② メールのリンクにだけ、使い捨ての合言葉（MOYAI が作る長い乱数。人が覚えて打つものではない）を入れる。
// ③ 受け手がリンクを開き、画面の「受け取る」を押すと、受け手の MOYAI が合言葉を頼みと照らし、受け手の鍵で「受け取り」に署名して置く（receipts/。最初の 1 つだけ）。
//    開いただけでは署名しない（ほかのページが開いたタブで、その PC の鍵の受け取りが置かれないように。Security の点検 11-08 の中6）。頼んだ鍵では受け取らない。
// ④ 承認・差し戻しは、受け取った鍵だけに通す。編集を頼んだときは、受け取った鍵の人が編集の番。
// 頼み直すと新しい頼みを置き、同じ版の前の頼みとその受け取りは効かなくなる（いちばん新しい頼みだけが効く）。
// ファイルは保管先の 1 組なので、頼む側と受け手の両方の PC から同じものが見える。
// 頼みとして数えるのは、その版を作った署名（confirm・edit・revert）の鍵で、その版の中身のハッシュに宛てたものだけ。
// 保管先に書ける人がほかの鍵で頼みを置いても、効いている頼みにはならない（数えずに、置かれていることを画面に出す。監査 B1 の追い）。
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize } from "../share/jcs";
import { HEX64, signBody, verifyBody, type KeyPair } from "../share/sign";
import { planDir } from "./paths";
import { CREATION_ROLES, type VersionInfo } from "./store";

export const REQUEST_V = "moyai.request/1";
export const RECEIPT_V = "moyai.receipt/1";

export interface RequestBody {
  v: typeof REQUEST_V;
  planId: string;
  version: number;
  contentHash: string;
  /** 頼むこと：承認か編集か */
  kind: "approve" | "edit";
  /** 宛先（メールアドレス。本人の確かめにはならない。画面に出すだけ） */
  to: string;
  /** 使い捨ての合言葉の SHA-256 */
  tokenHash: string;
  by: string;
  pub: string;
  at: string;
}

export interface ReceiptBody {
  v: typeof RECEIPT_V;
  planId: string;
  version: number;
  /** 受け取った頼みのファイルの SHA-256 */
  request: string;
  /** 使い捨ての合言葉そのもの（受け取ったあとは見えてもよい） */
  token: string;
  by: string;
  pub: string;
  at: string;
}

const sha = (b: string) => createHash("sha256").update(b).digest("hex");
const pad = (n: number) => String(n).padStart(6, "0");

function envelope<T>(body: T, pair: KeyPair): string {
  return `${JSON.stringify({ body, sig: signBody(body, pair.privateKey) }, null, 1)}\n`;
}

function open<T extends { pub: string }>(text: string): T | null {
  try {
    const e = JSON.parse(text) as { body?: T; sig?: unknown };
    if (!e.body || typeof e.sig !== "string" || !HEX64.test(e.body.pub)) return null;
    return verifyBody(e.body, e.sig, e.body.pub) ? e.body : null;
  } catch {
    return null;
  }
}

export interface Request {
  body: RequestBody;
  /** 頼みのファイルの SHA-256 */
  hash: string;
}

/** 頼みを置く（頼む人の鍵で署名）。合言葉を返す（メールのリンクにだけ入れる） */
export async function createRequest(i: {
  root: string;
  planId: string;
  version: number;
  contentHash: string;
  kind: "approve" | "edit";
  to: string;
  by: string;
  pair: KeyPair;
  now: Date;
}): Promise<{ token: string; request: Request }> {
  const token = randomBytes(32).toString("base64url");
  const body: RequestBody = {
    v: REQUEST_V,
    planId: i.planId,
    version: i.version,
    contentHash: i.contentHash,
    kind: i.kind,
    to: i.to,
    tokenHash: sha(token),
    by: i.by,
    pub: i.pair.pub,
    at: i.now.toISOString(),
  };
  const text = envelope(body, i.pair);
  const hash = sha(text);
  const dir = join(planDir(i.root, i.planId), "requests");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${pad(i.version)}-${sha(canonicalize(body)).slice(0, 16)}.json`), text, { encoding: "utf8", flag: "wx" });
  return { token, request: { body, hash } };
}

/** 頼みを数える相手の版：版の番号・中身のハッシュ・その版を作った署名 */
export type RequestVersion = Pick<VersionInfo, "version" | "contentHash" | "signatures">;

/**
 * その版の頼み（署名が合うものだけ、古い順）。requests はその版を作った鍵がその中身に宛てた頼み、
 * foreign はそれ以外の鍵か中身に宛てた頼み（数えない。置かれていることを画面に出す）
 */
export async function readRequests(root: string, planId: string, v: RequestVersion): Promise<{ requests: Request[]; foreign: Request[] }> {
  const dir = join(planDir(root, planId), "requests");
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.startsWith(`${pad(v.version)}-`) && n.endsWith(".json"));
  } catch {
    return { requests: [], foreign: [] };
  }
  const makers = new Set(v.signatures.filter((x) => CREATION_ROLES.includes(x.role)).map((x) => x.pub));
  const requests: Request[] = [];
  const foreign: Request[] = [];
  for (const n of names) {
    const text = await readFile(join(dir, n), "utf8");
    const body = open<RequestBody>(text);
    if (!body || body.v !== REQUEST_V || body.planId !== planId || body.version !== v.version) continue;
    (makers.has(body.pub) && body.contentHash === v.contentHash ? requests : foreign).push({ body, hash: sha(text) });
  }
  const byAt = (a: Request, b: Request) => (a.body.at < b.body.at ? -1 : a.body.at > b.body.at ? 1 : 0);
  return { requests: requests.sort(byAt), foreign: foreign.sort(byAt) };
}

/** 受け取り（その頼みに、署名が合うもの） */
export async function readReceipt(root: string, req: Request): Promise<ReceiptBody | null> {
  try {
    const text = await readFile(join(planDir(root, req.body.planId), "receipts", `${req.hash.slice(0, 16)}.json`), "utf8");
    const body = open<ReceiptBody>(text);
    return body && body.v === RECEIPT_V && body.request === req.hash && sha(body.token) === req.body.tokenHash ? body : null;
  } catch {
    return null;
  }
}

/** その版で効いている頼み（いちばん新しいもの）と、その受け取り。頼みが無ければ null */
export async function activeRequest(root: string, planId: string, v: RequestVersion): Promise<{ request: Request; receipt: ReceiptBody | null } | null> {
  const { requests } = await readRequests(root, planId, v);
  const request = requests.at(-1);
  if (!request) return null;
  return { request, receipt: await readReceipt(root, request) };
}

export type ReceiveResult =
  | { state: "received" | "mine"; request: Request }
  /** 頼んだ鍵と同じ鍵では受け取らない（自分の頼みは受け取れない。Security の点検 11-08 の中6） */
  | { state: "ownRequest"; request: Request }
  /** ほかの鍵が先に受け取っていた */
  | { state: "takenByOther"; request: Request; receipt: ReceiptBody }
  /** 頼み直されて、この合言葉の頼みはもう効かない */
  | { state: "withdrawn" }
  /** この版に、この合言葉の頼みが無い */
  | { state: "unknown" };

/** 「受け取る」を押した人の MOYAI が、合言葉を頼みと照らし、受け手の鍵で受け取りに署名して置く（最初の 1 つだけ。頼んだ鍵では置かない） */
export async function receiveRequest(i: { root: string; planId: string; version: RequestVersion; token: string; by: string; pair: KeyPair; now: Date }): Promise<ReceiveResult> {
  const { requests: all } = await readRequests(i.root, i.planId, i.version);
  const hit = all.find((r) => r.body.tokenHash === sha(i.token));
  if (!hit) return { state: "unknown" };
  if (hit !== all.at(-1)) return { state: "withdrawn" };
  if (hit.body.pub === i.pair.pub) return { state: "ownRequest", request: hit };
  const existing = await readReceipt(i.root, hit);
  if (existing) return existing.pub === i.pair.pub ? { state: "mine", request: hit } : { state: "takenByOther", request: hit, receipt: existing };
  const body: ReceiptBody = { v: RECEIPT_V, planId: i.planId, version: i.version.version, request: hit.hash, token: i.token, by: i.by, pub: i.pair.pub, at: i.now.toISOString() };
  const dir = join(planDir(i.root, i.planId), "receipts");
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, `${hit.hash.slice(0, 16)}.json`), envelope(body, i.pair), { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // ほぼ同時にほかの人が受け取った
    const other = await readReceipt(i.root, hit);
    if (other && other.pub !== i.pair.pub) return { state: "takenByOther", request: hit, receipt: other };
  }
  return { state: "received", request: hit };
}
