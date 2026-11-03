// exceljs 4.4.0 の中の部品（版を固定して当てる直しのためだけ。exceljs-setup.ts で使う）。
declare module "exceljs/lib/utils/utils.js" {
  const utils: { isDateFmt: (fmt: string) => boolean };
  export default utils;
}
declare module "exceljs/lib/xlsx/xform/style/numfmt-xform.js" {
  const NumFmtXform: {
    prototype: {
      parseOpen: (node: { name: string; attributes: Record<string, string> }) => boolean;
      model?: unknown;
    };
  };
  export default NumFmtXform;
}
declare module "exceljs/lib/xlsx/defaultnumformats.js" {
  const defaults: Record<string, { f?: string }>;
  export default defaults;
}
