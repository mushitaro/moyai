// 試験の道具：小さな PDF を手で書く（取り込みの読み手の代わりではない。読み手に渡す試験の資料を作るだけ）。
// 文字は埋め込みの無い日本語の書体（Type0・CID・Encoding UniJIS-UCS2-H・Adobe-Japan1）で書く。
// cMap が無いと文字を読めない書体なので、同梱の cMap を使って読めることを、どの試験でも通る。
// 座標は頁の左上を原点に、右と下へ pt（PDF の中では下からに直す）。

export interface PdfText {
  x: number;
  y: number;
  text: string;
  size?: number;
  /** 文字を回す（度）。縦書き・斜めの文字の試験に使う */
  rotate?: number;
  /** "latin"：埋め込みの無い標準の 14 書体（Helvetica・WinAnsiEncoding）。ASCII だけ */
  font?: "jp" | "latin";
}

export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfPage {
  width?: number;
  height?: number;
  texts?: PdfText[];
  lines?: PdfLine[];
  /** 頁いっぱいの画像だけを描く（スキャンの頁の代わり） */
  image?: boolean;
  /** 頁の中身をまとめて変換する（cm）。罫線の座標の読み方の試験に使う */
  cm?: [number, number, number, number, number, number];
}

const hex4 = (s: string) =>
  [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp > 0xffff) throw new Error("UCS-2 の外の文字は書けない");
      return cp.toString(16).toUpperCase().padStart(4, "0");
    })
    .join("");

export function pdfOf(pages: PdfPage[]): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => {
    objs.push(body);
    return objs.length;
  };
  // 1 カタログ、2 頁の木（あとで中身を入れる）、3〜5 書体、6 画像
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  add("<< /Type /Font /Subtype /Type0 /BaseFont /MS-Gothic /Encoding /UniJIS-UCS2-H /DescendantFonts [4 0 R] >>");
  add("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MS-Gothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 5 0 R /DW 1000 >>");
  add("<< /Type /FontDescriptor /FontName /MS-Gothic /Flags 4 /FontBBox [0 -141 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 709 /StemV 80 >>");
  const img = "@@@@";
  add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${img.length} >>\nstream\n${img}\nendstream`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const p of pages) {
    const W = p.width ?? 595;
    const H = p.height ?? 842;
    const ops: string[] = ["q"];
    if (p.cm) ops.push(`${p.cm.join(" ")} cm`);
    if (p.image) ops.push(`q ${W - 40} 0 0 ${H - 40} 20 20 cm /Im1 Do Q`);
    for (const l of p.lines ?? []) ops.push(`0.6 w ${l.x1} ${H - l.y1} m ${l.x2} ${H - l.y2} l S`);
    for (const t of p.texts ?? []) {
      const size = t.size ?? 10;
      const r = ((t.rotate ?? 0) * Math.PI) / 180;
      const [a, b, c, d] = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)].map((v) => Math.round(v * 1e6) / 1e6);
      if (t.font === "latin") {
        if (!/^[\x20-\x7e]*$/.test(t.text)) throw new Error("標準の 14 書体は ASCII だけ");
        ops.push(`BT /F2 ${size} Tf ${a} ${b} ${c} ${d} ${t.x} ${H - t.y} Tm (${t.text.replace(/[()\\]/g, (m) => `\\${m}`)}) Tj ET`);
      } else ops.push(`BT /F1 ${size} Tf ${a} ${b} ${c} ${d} ${t.x} ${H - t.y} Tm <${hex4(t.text)}> Tj ET`);
    }
    ops.push("Q");
    const content = ops.join("\n");
    const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 7 0 R >> /XObject << /Im1 6 0 R >> >> /Contents ${cid} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // 中身は ASCII だけ（文字は 16 進で書く）
  return new TextEncoder().encode(out);
}

/** 罫線で囲んだ表（列の境の x と、行の上の y）。見出しの行と中身の行を書く */
export function ruledTable(opts: { xs: number[]; top: number; rowHeight: number; rows: string[][]; size?: number }): { texts: PdfText[]; lines: PdfLine[] } {
  const { xs, top, rowHeight, rows } = opts;
  const size = opts.size ?? 9;
  const texts: PdfText[] = [];
  const lines: PdfLine[] = [];
  const bottom = top + rowHeight * rows.length;
  for (const x of xs) lines.push({ x1: x, y1: top, x2: x, y2: bottom });
  for (let i = 0; i <= rows.length; i++) lines.push({ x1: xs[0] ?? 0, y1: top + i * rowHeight, x2: xs[xs.length - 1] ?? 0, y2: top + i * rowHeight });
  rows.forEach((row, i) => {
    row.forEach((cell, j) => {
      if (cell === "") return;
      texts.push({ x: (xs[j] ?? 0) + 2, y: top + (i + 1) * rowHeight - 3, text: cell, size });
    });
  });
  return { texts, lines };
}
