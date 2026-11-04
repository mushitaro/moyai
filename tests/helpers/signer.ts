// 試験で版に署名する人（架空の呼び名と、その場で作った鍵。合言葉で包まない）
import type { Signer } from "../../src/plan/store";
import { generateKeyPair } from "../../src/share/sign";

export const SIGNER: Signer = { by: "【架空】試験の人", pair: generateKeyPair() };
export const otherSigner = (by = "【架空】別の人"): Signer => ({ by, pair: generateKeyPair() });
