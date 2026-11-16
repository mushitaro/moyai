// 業務システムごとの読み書きの部品（`@mxstage/eam-connectors`、BUSL-1.1、TSUNAGI。運営者が承認した形 2026-11-16）へのつなぎ（薄い adapter）。
// 部品は MOYAI の optionalDependencies として持ち、無ければ連携のつなぎ先を出さない。部品は今 MX Stage から切り出している途中なので、
// 中身は【未実装】：部品が入ったら、下の予定の形に合わせて ConnectBackend を作る（loadPackageBackend が null を返すあいだは、つなぎ先は出ない）。
//
// 部品の予定の形（統括から 2026-11-16。確かめていない）：
// - `@mxstage/eam-connectors`：MaximoClient・loadRecords・planCommit・executeCommit・中間形〔資産の木・保全計画・作業の実績〕
// - `@mxstage/eam-connectors/node`：ConnectionStore・LicenseStore〔authorize〕・stateDir
// - `@mxstage/eam-connectors/testing`：createFakeMaximo
// 合わせ方：ConnectionStore → ConnectionStoreLike（list・open。秘密は opaque のまま渡す）、LicenseStore.authorize(host) → LicenseCheck、
// loadRecords・planCommit・executeCommit → EamConnector（中間形は src/shared/connect.ts の EamRecords に写す）。
import type { ConnectBackend } from "./types";

/** 部品の名前（optionalDependencies に足すのは、部品が公開されてから） */
export const EAM_PACKAGE = "@mxstage/eam-connectors";

/**
 * 部品から連携の裏を作る。部品が無い・まだつないでいないときは null（つなぎ先を出さない）。
 * 【未実装】部品が入るまでは、いつも null。
 */
export async function loadPackageBackend(_stateDir: string): Promise<ConnectBackend | null> {
  return null;
}
