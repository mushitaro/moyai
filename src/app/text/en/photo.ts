// The photo panel (intake) in English. The Japanese table in ../photo.ts must have the same shape.
import { PHOTO_TOOL_TEXT } from "../photo-tool";

const n = (v: number) => v.toLocaleString("en-US");

export const EN_PHOTO_TEXT = {
  title: "Photos (read via the AI client)",
  lead:
    "Photos (JPEG, PNG) are listed without being read. Only photos you send one by one with [Send to AI client to read] are read. " +
    "That image goes to the AI client (Claude Code, Claude Desktop) and on to its AI provider. " +
    "The grid the AI reads is marked “Needs review”; no plan can be made until a person checks it against the image.",
  none: "No photos. Drop a JPEG or PNG onto the source files area and it appears here.",
  size: (kb: number) => `${n(kb)} KB`,
  pages: (file: string, page: number) => `${file}, page ${page} (no text)`,
  state: {
    unread: "Not read",
    allowed: "Allowed (waiting for the AI to receive)",
    sent: "Sent to AI (waiting for the reading)",
    read: "Needs review",
    confirmed: "Checked by a person",
    excluded: "Excluded without reading",
  },
  allow: "Send to AI client to read",
  allowAgain: "Send again",
  allowDisabled: "Reason: Bridge not connected",
  exclude: "Exclude without reading",
  include: "Restore",
  excludedNote: "Excluded without reading. Not in the plan (counted as an unread source file, with the reason).",
  allowedNote: (at: string) => `At ${at}, a person allowed sending this to the AI client. Waiting for the AI to receive it with photo_transcribe (receive).`,
  sentNote: (at: string) => `Sent to the AI client at ${at}. Waiting for the AI to place the grid it read.`,
  unreadNote: "Not read yet. No plan can be made until it is read or excluded.",
  dialog: {
    title: "Send photo to the AI client",
    preparing: "Preparing the image (shrunk and converted to JPEG on this screen)",
    lead: (name: string) => `“${name}” is sent once to the AI client, as the image below.`,
    shape: (w: number, h: number, kb: number, q: number | null) => `${w} × ${h} px, JPEG ${n(kb)} KB${q === null ? "" : ` (quality ${Math.round(q * 100)})`}`,
    from: (w: number, h: number) => `Made from the original ${w} × ${h} px image (not cropped; location and other metadata removed).`,
    overTarget: (kb: number) => `Over the 100 KB target (${n(kb)} KB). It can still be sent.`,
    where: "The image goes to the AI client and on to its AI provider. It cannot be taken back once sent.",
    once: "The permission works once, for this image only. It is used up when the AI receives it.",
    failed: "Could not open this image (it is damaged, or the browser cannot read the format).",
    tooLarge: (kb: number) => `Still ${n(kb)} KB after shrinking — over the limit, so it cannot be sent.`,
    previewAlt: (name: string) => `Image to send to the AI client (${name})`,
    cancel: "Cancel",
    submit: "Allow sending",
  },
  review: {
    title: "Check the reading against the image",
    reviewCount: (cells: number, records: number | null) => (records ? `Needs review: ${cells} cells (${records} records from this photo)` : `Needs review: ${cells} cells`),
    by: (at: string) => `Grid placed by the AI (reading) at ${at}`,
    imageAlt: (name: string) => `${name} (image sent to the AI; boxes mark the cells read)`,
    pick: "Select a cell in the table or the image to see its position, the text the AI read and its confidence here.",
    cell: (row: number, col: number) => `Row ${row + 1}, col ${col + 1}`,
    aiText: (t: string) => `Text read by the AI: “${t}”`,
    confidence: (c: number) => `Confidence ${c.toFixed(2)}`,
    low: "Low confidence",
    human: "Corrected by a person",
    cleared: "(cleared by a person)",
    fix: "Correct",
    fixLabel: "Text of this cell",
    fixHint: "Leave empty to remove this cell from the grid.",
    reasonLabel: "Reason for the check",
    reasonPlaceholder: "e.g. Compared row by row with the table in the image; text and numbers match",
    confirm: "Checked",
    confirmNeedsReason: "Reason: No reason entered",
    confirmed: (at: string, reason: string) => `Checked by a person at ${at} (reason: ${reason}). The records from this photo no longer need review.`,
    unconfirm: "Undo the check",
    discard: "Discard the reading",
    discardHint: "Also discards the corrections, so the AI can place a grid again.",
    refused: {
      unknown: "This photo no longer exists.",
      no_reading: "No reading yet.",
      confirmed: "Cannot correct after the check. Undo the check first.",
      no_cell: "That cell is not in the reading.",
      reason_empty: "The reason is empty.",
    } as Record<string, string>,
  },
  // The AI activity panel (intake)
  ai: {
    received: (name: string) => `The AI received the photo “${name}” (the permission is used up)`,
    receiveRefused: "The AI tried to receive a photo, but no photo was allowed, so it was refused",
    placed: (name: string, cells: number) => `The AI placed the grid it read on “${name}” (${cells} cells; needs review until a person checks it)`,
    placeRefused: (name: string) => `The grid the AI tried to place on “${name}” was refused (no cells placed)`,
    allowed: (name: string) => `A person allowed sending the photo “${name}” to the AI client`,
  },
  // Tool results go to the AI: not translated (same text on the English screen)
  tool: PHOTO_TOOL_TEXT,
};
