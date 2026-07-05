// Built-in document & form templates. Each builds a fresh PDF with pdf-lib;
// the fillable ones place real AcroForm fields so they're ready to fill in the
// editor (and their appearances get regenerated via PDFium on save).
import {
  PDFDocument,
  PDFFont,
  PDFForm,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

const W = 612;
const H = 792; // US Letter
const M = 54; // margin
const INK = rgb(0.12, 0.12, 0.15);
const MUTED = rgb(0.42, 0.42, 0.48);
const RULE = rgb(0.8, 0.8, 0.84);
const FIELD_BG = rgb(0.97, 0.975, 0.99);
const ACCENT = rgb(0.15, 0.39, 0.92);

// --- Blank document --------------------------------------------------------

/** Named page sizes in PDF points (1pt = 1/72"), given portrait (w × h). */
export const PAGE_SIZES = [
  { id: "letter", name: "Letter", w: 612, h: 792, hint: '8.5 × 11"' },
  { id: "legal", name: "Legal", w: 612, h: 1008, hint: '8.5 × 14"' },
  { id: "tabloid", name: "Tabloid", w: 792, h: 1224, hint: '11 × 17"' },
  { id: "a3", name: "A3", w: 842, h: 1191, hint: "297 × 420 mm" },
  { id: "a4", name: "A4", w: 595, h: 842, hint: "210 × 297 mm" },
  { id: "a5", name: "A5", w: 420, h: 595, hint: "148 × 210 mm" },
] as const;

export type PageSizeId = (typeof PAGE_SIZES)[number]["id"];
export type Orientation = "portrait" | "landscape";

export interface BlankPdfOptions {
  size?: PageSizeId;
  orientation?: Orientation;
  pages?: number;
}

/** Build a blank PDF with the given page size, orientation and page count. */
export async function createBlankPdf(
  opts: BlankPdfOptions = {},
): Promise<Uint8Array> {
  const { size = "letter", orientation = "portrait", pages = 1 } = opts;
  const def = PAGE_SIZES.find((s) => s.id === size) ?? PAGE_SIZES[0];
  const [w, h] =
    orientation === "landscape" ? [def.h, def.w] : [def.w, def.h];
  const count = Math.max(1, Math.min(100, Math.floor(pages)));
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([w, h]);
  return doc.save();
}

export type TemplateCategory = "form" | "document";

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  build: () => Promise<Uint8Array>;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  form: PDFForm;
}

async function start(): Promise<Ctx> {
  const doc = await PDFDocument.create();
  const [font, bold, italic] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const page = doc.addPage([W, H]);
  return { doc, page, font, bold, italic, form: doc.getForm() };
}

function text(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; bold?: boolean; italic?: boolean; color?: any } = {},
) {
  c.page.drawText(s, {
    x,
    y,
    size: opts.size ?? 10,
    font: opts.bold ? c.bold : opts.italic ? c.italic : c.font,
    color: opts.color ?? INK,
  });
}

function rule(c: Ctx, x: number, y: number, w: number, color = RULE, thickness = 0.75) {
  c.page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
}

function field(
  c: Ctx,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { multiline?: boolean; size?: number } = {},
) {
  const f = c.form.createTextField(name);
  if (opts.multiline) f.enableMultiline();
  f.addToPage(c.page, {
    x,
    y,
    width: w,
    height: h,
    borderWidth: 0.75,
    borderColor: RULE,
    backgroundColor: FIELD_BG,
  });
  // Font size must be set after addToPage (which creates the /DA entry).
  f.setFontSize(opts.size ?? 11);
  return f;
}

/** A label above a single-line field. */
function labeledField(
  c: Ctx,
  label: string,
  name: string,
  x: number,
  y: number,
  w: number,
  h = 20,
) {
  text(c, label, x, y + h + 4, { size: 8, bold: true, color: MUTED });
  field(c, name, x, y, w, h);
}

function checkbox(c: Ctx, name: string, x: number, y: number, label: string) {
  const cb = c.form.createCheckBox(name);
  cb.addToPage(c.page, {
    x,
    y,
    width: 12,
    height: 12,
    borderWidth: 0.75,
    borderColor: MUTED,
    backgroundColor: FIELD_BG,
  });
  text(c, label, x + 18, y + 2, { size: 9 });
}

function title(c: Ctx, t: string, subtitle?: string) {
  text(c, t, M, H - M - 6, { size: 22, bold: true });
  if (subtitle) text(c, subtitle, M, H - M - 24, { size: 10, color: MUTED });
}

// --- Fillable forms --------------------------------------------------------

async function invoice(): Promise<Uint8Array> {
  const c = await start();
  c.page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT });
  text(c, "INVOICE", M, H - M - 4, { size: 26, bold: true });
  text(c, "Your Company Name", W - M - 200, H - M - 2, { size: 11, bold: true });
  text(c, "123 Business Rd · City, ST", W - M - 200, H - M - 16, { size: 8, color: MUTED });

  labeledField(c, "BILL TO", "bill_to", M, H - 175, 250, 46);
  labeledField(c, "INVOICE #", "invoice_no", W - M - 200, H - 145, 200);
  labeledField(c, "DATE", "invoice_date", W - M - 200, H - 200, 95);
  labeledField(c, "DUE DATE", "due_date", W - M - 95, H - 200, 95);

  // Line-item table
  let y = H - 260;
  const cols = [M, M + 250, M + 340, W - M - 90];
  c.page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 22, color: rgb(0.95, 0.96, 0.99) });
  const heads = ["DESCRIPTION", "QTY", "UNIT PRICE", "AMOUNT"];
  heads.forEach((h, i) => text(c, h, cols[i] + 4, y + 4, { size: 8, bold: true, color: MUTED }));
  y -= 12;
  for (let r = 0; r < 6; r++) {
    y -= 26;
    field(c, `item_desc_${r}`, cols[0], y, 246, 22);
    field(c, `item_qty_${r}`, cols[1], y, 86, 22);
    field(c, `item_price_${r}`, cols[2], y, 86, 22);
    field(c, `item_amount_${r}`, cols[3], y, 90, 22);
  }
  y -= 40;
  text(c, "Subtotal", cols[2], y + 6, { size: 9, bold: true, color: MUTED });
  field(c, "subtotal", cols[3], y, 90, 20);
  y -= 26;
  text(c, "Tax", cols[2], y + 6, { size: 9, bold: true, color: MUTED });
  field(c, "tax", cols[3], y, 90, 20);
  y -= 26;
  text(c, "TOTAL", cols[2], y + 6, { size: 11, bold: true });
  field(c, "total", cols[3], y, 90, 22, { size: 13 });

  text(c, "Notes / payment terms", M, 150, { size: 8, bold: true, color: MUTED });
  field(c, "notes", M, 90, W - 2 * M, 52, { multiline: true });
  return c.doc.save();
}

async function jobApplication(): Promise<Uint8Array> {
  const c = await start();
  title(c, "Job Application", "Please complete all fields.");
  rule(c, M, H - M - 34, W - 2 * M);
  let y = H - 130;
  const half = (W - 2 * M - 16) / 2;
  labeledField(c, "FULL NAME", "full_name", M, y, half);
  labeledField(c, "POSITION APPLIED FOR", "position", M + half + 16, y, half);
  y -= 58;
  labeledField(c, "EMAIL", "email", M, y, half);
  labeledField(c, "PHONE", "phone", M + half + 16, y, half);
  y -= 58;
  labeledField(c, "ADDRESS", "address", M, y, W - 2 * M);
  y -= 58;
  labeledField(c, "EARLIEST START DATE", "start_date", M, y, half);
  labeledField(c, "DESIRED SALARY", "salary", M + half + 16, y, half);
  y -= 46;
  text(c, "Availability", M, y, { size: 8, bold: true, color: MUTED });
  y -= 16;
  checkbox(c, "avail_full", M, y, "Full-time");
  checkbox(c, "avail_part", M + 110, y, "Part-time");
  checkbox(c, "avail_remote", M + 220, y, "Remote");
  checkbox(c, "avail_relocate", M + 330, y, "Willing to relocate");
  y -= 30;
  text(c, "RELEVANT EXPERIENCE", M, y, { size: 8, bold: true, color: MUTED });
  field(c, "experience", M, y - 96, W - 2 * M, 90, { multiline: true });
  y -= 120;
  text(c, "WHY DO YOU WANT THIS ROLE?", M, y, { size: 8, bold: true, color: MUTED });
  field(c, "motivation", M, y - 76, W - 2 * M, 70, { multiline: true });
  return c.doc.save();
}

async function feedbackSurvey(): Promise<Uint8Array> {
  const c = await start();
  title(c, "Customer Feedback", "We value your opinion — it takes 2 minutes.");
  rule(c, M, H - M - 34, W - 2 * M);
  let y = H - 120;
  labeledField(c, "NAME (OPTIONAL)", "name", M, y, (W - 2 * M - 16) / 2);
  labeledField(c, "DATE", "date", M + (W - 2 * M - 16) / 2 + 16, y, (W - 2 * M - 16) / 2);
  y -= 54;
  const questions = [
    "Overall satisfaction",
    "Quality of the product",
    "Value for money",
    "Likelihood to recommend",
  ];
  for (const q of questions) {
    text(c, q, M, y, { size: 10, bold: true });
    const group = c.form.createRadioGroup(`rate_${q.replace(/\W+/g, "_").toLowerCase()}`);
    const labels = ["1", "2", "3", "4", "5"];
    labels.forEach((lb, i) => {
      const x = W - M - 190 + i * 40;
      group.addOptionToPage(lb, c.page, {
        x,
        y: y - 2,
        width: 12,
        height: 12,
        borderWidth: 0.75,
        borderColor: MUTED,
      });
      text(c, lb, x + 15, y, { size: 9, color: MUTED });
    });
    text(c, "poor", W - M - 220, y, { size: 7, color: MUTED });
    y -= 34;
  }
  y -= 10;
  text(c, "WHAT COULD WE IMPROVE?", M, y, { size: 8, bold: true, color: MUTED });
  field(c, "comments", M, y - 106, W - 2 * M, 100, { multiline: true });
  return c.doc.save();
}

async function nda(): Promise<Uint8Array> {
  const c = await start();
  title(c, "Non-Disclosure Agreement", "Mutual confidentiality agreement.");
  rule(c, M, H - M - 34, W - 2 * M);
  let y = H - 120;
  const half = (W - 2 * M - 16) / 2;
  labeledField(c, "DISCLOSING PARTY", "party_a", M, y, half);
  labeledField(c, "RECEIVING PARTY", "party_b", M + half + 16, y, half);
  y -= 54;
  labeledField(c, "EFFECTIVE DATE", "effective_date", M, y, half);
  y -= 50;
  const body = [
    "1. The parties wish to explore a business opportunity and, in connection",
    "   with this, may disclose Confidential Information to each other.",
    "2. \"Confidential Information\" means any non-public information disclosed by",
    "   one party to the other, whether orally, in writing, or otherwise.",
    "3. The receiving party agrees to keep the Confidential Information secret and",
    "   to use it solely for the purpose of the potential business relationship.",
    "4. This agreement remains in effect for a period of two (2) years from the",
    "   effective date stated above.",
  ];
  for (const line of body) {
    text(c, line, M, y, { size: 9.5 });
    y -= 16;
  }
  y -= 40;
  const sigW = (W - 2 * M - 30) / 2;
  rule(c, M, y, sigW, INK, 1);
  rule(c, M + sigW + 30, y, sigW, INK, 1);
  text(c, "Signature — Disclosing Party", M, y - 12, { size: 8, color: MUTED });
  text(c, "Signature — Receiving Party", M + sigW + 30, y - 12, { size: 8, color: MUTED });
  y -= 44;
  labeledField(c, "PRINT NAME", "sign_name_a", M, y, sigW);
  labeledField(c, "PRINT NAME", "sign_name_b", M + sigW + 30, y, sigW);
  return c.doc.save();
}

async function timesheet(): Promise<Uint8Array> {
  const c = await start();
  title(c, "Weekly Timesheet");
  let y = H - 100;
  const half = (W - 2 * M - 16) / 2;
  labeledField(c, "EMPLOYEE", "employee", M, y, half);
  labeledField(c, "WEEK ENDING", "week_ending", M + half + 16, y, half);
  y -= 54;
  const cols = [M, M + 150, M + 280, M + 410];
  const heads = ["DAY", "TIME IN", "TIME OUT", "HOURS"];
  c.page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 22, color: rgb(0.95, 0.96, 0.99) });
  heads.forEach((h, i) => text(c, h, cols[i] + 6, y + 4, { size: 8, bold: true, color: MUTED }));
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  y -= 4;
  for (const d of days) {
    y -= 28;
    text(c, d, cols[0] + 6, y + 8, { size: 10 });
    field(c, `in_${d}`, cols[1], y, 120, 22);
    field(c, `out_${d}`, cols[2], y, 120, 22);
    field(c, `hrs_${d}`, cols[3], y, W - M - cols[3], 22);
  }
  y -= 40;
  text(c, "TOTAL HOURS", cols[2], y + 6, { size: 10, bold: true });
  field(c, "total_hours", cols[3], y, W - M - cols[3], 22, { size: 13 });
  y -= 60;
  rule(c, M, y, 200, INK, 1);
  text(c, "Approved by (signature)", M, y - 12, { size: 8, color: MUTED });
  return c.doc.save();
}

// --- Document starters -----------------------------------------------------

async function letter(): Promise<Uint8Array> {
  const c = await start();
  text(c, "Your Name", M, H - M, { size: 16, bold: true });
  text(c, "123 Street · City, ST 00000 · you@email.com", M, H - M - 16, { size: 9, color: MUTED });
  rule(c, M, H - M - 26, W - 2 * M);
  let y = H - M - 60;
  text(c, "Date: ____________________", M, y, { size: 10 });
  y -= 40;
  text(c, "Recipient Name", M, y, { size: 10, bold: true });
  y -= 14;
  text(c, "Company · Address", M, y, { size: 10, color: MUTED });
  y -= 40;
  text(c, "Dear ____________________,", M, y, { size: 11 });
  y -= 30;
  for (let i = 0; i < 12; i++) {
    rule(c, M, y, W - 2 * M, rgb(0.9, 0.9, 0.92), 0.5);
    y -= 24;
  }
  y -= 6;
  text(c, "Sincerely,", M, y, { size: 11 });
  y -= 40;
  text(c, "____________________", M, y, { size: 11 });
  text(c, "Your Name", M, y - 14, { size: 9, color: MUTED });
  return c.doc.save();
}

async function meetingNotes(): Promise<Uint8Array> {
  const c = await start();
  title(c, "Meeting Notes");
  let y = H - 100;
  text(c, "Title", M, y, { size: 8, bold: true, color: MUTED });
  rule(c, M + 60, y, W - M - 60 - M);
  text(c, "Date", M, y - 24, { size: 8, bold: true, color: MUTED });
  rule(c, M + 60, y - 24, 180);
  text(c, "Attendees", M + 260, y - 24, { size: 8, bold: true, color: MUTED });
  rule(c, M + 320, y - 24, W - M - (M + 320));
  y -= 60;
  const section = (heading: string, lines: number) => {
    text(c, heading, M, y, { size: 12, bold: true, color: ACCENT });
    y -= 22;
    for (let i = 0; i < lines; i++) {
      rule(c, M, y, W - 2 * M, rgb(0.9, 0.9, 0.92), 0.5);
      y -= 22;
    }
    y -= 12;
  };
  section("Agenda", 4);
  section("Discussion", 6);
  section("Action items", 5);
  return c.doc.save();
}

async function resume(): Promise<Uint8Array> {
  const c = await start();
  text(c, "YOUR NAME", M, H - M, { size: 24, bold: true });
  text(c, "Job Title", M, H - M - 20, { size: 12, color: ACCENT });
  text(c, "you@email.com · (555) 000-0000 · City, ST · linkedin.com/in/you", M, H - M - 36, {
    size: 9,
    color: MUTED,
  });
  rule(c, M, H - M - 46, W - 2 * M, INK, 1);
  let y = H - M - 74;
  const section = (heading: string, lines: number) => {
    text(c, heading.toUpperCase(), M, y, { size: 11, bold: true, color: ACCENT });
    rule(c, M + 110, y + 3, W - M - (M + 110));
    y -= 20;
    for (let i = 0; i < lines; i++) {
      rule(c, M, y, W - 2 * M, rgb(0.9, 0.9, 0.92), 0.5);
      y -= 20;
    }
    y -= 14;
  };
  section("Summary", 3);
  section("Experience", 7);
  section("Education", 3);
  section("Skills", 3);
  return c.doc.save();
}

export const TEMPLATES: TemplateDef[] = [
  { id: "invoice", name: "Invoice", description: "Billing invoice with line items and totals.", category: "form", build: invoice },
  { id: "job-application", name: "Job Application", description: "Applicant details, availability and experience.", category: "form", build: jobApplication },
  { id: "feedback", name: "Feedback Survey", description: "1–5 ratings and comments.", category: "form", build: feedbackSurvey },
  { id: "nda", name: "Non-Disclosure Agreement", description: "Mutual NDA with signature lines.", category: "form", build: nda },
  { id: "timesheet", name: "Weekly Timesheet", description: "Daily time in/out and total hours.", category: "form", build: timesheet },
  { id: "letter", name: "Business Letter", description: "Letterhead and body lines to write on.", category: "document", build: letter },
  { id: "meeting-notes", name: "Meeting Notes", description: "Agenda, discussion and action items.", category: "document", build: meetingNotes },
  { id: "resume", name: "Résumé", description: "Clean single-page résumé layout.", category: "document", build: resume },
];
