// "PickPDF Protected" wrapper — lock a document to PickPDF.
//
// The real PDF is encrypted with AES-256-GCM (key derived from a password via
// PBKDF2) and embedded as an attachment inside a WRAPPER PDF whose only
// visible page is a notice: "This document is protected — open it in PickPDF."
// Any other viewer (Chrome, Acrobat, Preview…) renders just that notice; the
// content is genuine ciphertext and unreadable without the password. PickPDF
// detects the wrapper on open, prompts for the password and decrypts.
//
// This is real encryption (as strong as the password), not obfuscation — the
// wrapper is only the friendly notice around it.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Attachment filename that marks a PickPDF-protected wrapper. */
export const WRAPPER_ATTACHMENT = "pickpdf-protected.bin";

/** Payload header magic — versioned so the format can evolve. */
const MAGIC = "PKPDFSEC1";
const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 250_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt PDF bytes → payload (magic + salt + iv + ciphertext). */
export async function encryptPayload(
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      bytes as unknown as BufferSource,
    ),
  );
  const magic = new TextEncoder().encode(MAGIC);
  const out = new Uint8Array(magic.length + SALT_LEN + IV_LEN + ct.length);
  out.set(magic, 0);
  out.set(salt, magic.length);
  out.set(iv, magic.length + SALT_LEN);
  out.set(ct, magic.length + SALT_LEN + IV_LEN);
  return out;
}

/** True when `payload` carries the PickPDF-protected header. */
export function isProtectedPayload(payload: Uint8Array): boolean {
  const magic = new TextEncoder().encode(MAGIC);
  if (payload.length < magic.length + SALT_LEN + IV_LEN + 16) return false;
  return magic.every((b, i) => payload[i] === b);
}

/** Decrypt a payload back to the original PDF bytes. Throws "Wrong password". */
export async function decryptPayload(
  payload: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  if (!isProtectedPayload(payload)) {
    throw new Error("Not a PickPDF-protected payload");
  }
  const off = MAGIC.length;
  const salt = payload.slice(off, off + SALT_LEN);
  const iv = payload.slice(off + SALT_LEN, off + SALT_LEN + IV_LEN);
  const ct = payload.slice(off + SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    // GCM authentication failure — wrong password (or corrupted payload).
    throw new Error("Wrong password");
  }
}

// ---------------------------------------------------------------------------
// The wrapper PDF with its notice page
// ---------------------------------------------------------------------------

const INDIGO = rgb(0.31, 0.275, 0.898); // #4F46E5
const SLATE_900 = rgb(0.059, 0.09, 0.165); // #0F172A
const SLATE_500 = rgb(0.392, 0.455, 0.545); // #64748B
const SLATE_200 = rgb(0.886, 0.91, 0.941); // #E2E8F0

/** Rounded-rect SVG path (y-down), for badges/cards pdf-lib can't draw natively. */
function roundedRectPath(w: number, h: number, r: number): string {
  return (
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} ` +
    `A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} ` +
    `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`
  );
}

/**
 * Build the wrapper: a single professional notice page + the encrypted real
 * document attached. `originalName` is shown on the notice.
 */
export async function wrapProtected(
  pdfBytes: Uint8Array,
  password: string,
  originalName: string,
): Promise<Uint8Array> {
  const payload = await encryptPayload(pdfBytes, password);

  const doc = await PDFDocument.create();
  doc.setTitle("Protected document — open with PickPDF");
  doc.setSubject("PickPDF-Protected-v1");
  doc.setProducer("PickPDF");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([612, 792]); // US Letter
  const cx = 306;
  const center = (
    text: string,
    y: number,
    size: number,
    font = regular,
    color = SLATE_500,
  ) =>
    page.drawText(text, {
      x: cx - font.widthOfTextAtSize(text, size) / 2,
      y,
      size,
      font,
      color,
    });

  // Card
  const cardW = 460;
  const cardH = 420;
  const cardX = cx - cardW / 2;
  const cardYTop = 640; // top edge (pdf-lib y-up: drawSvgPath y = top)
  page.drawSvgPath(roundedRectPath(cardW, cardH, 16), {
    x: cardX,
    y: cardYTop,
    color: rgb(1, 1, 1),
    borderColor: SLATE_200,
    borderWidth: 1.5,
  });

  // Lock badge — indigo rounded square with a white lock
  const badge = 88;
  const badgeX = cx - badge / 2;
  const badgeYTop = 610;
  page.drawSvgPath(roundedRectPath(badge, badge, 20), {
    x: badgeX,
    y: badgeYTop,
    color: INDIGO,
  });
  // Lock shackle (white stroke arc)
  page.drawSvgPath("M 0 14 V 10 A 12 12 0 0 1 24 10 V 14", {
    x: badgeX + 32,
    y: badgeYTop - 22,
    borderColor: rgb(1, 1, 1),
    borderWidth: 6,
  });
  // Lock body (white rounded rect) + indigo keyhole
  page.drawSvgPath(roundedRectPath(40, 30, 6), {
    x: badgeX + 24,
    y: badgeYTop - 36,
    color: rgb(1, 1, 1),
  });
  page.drawCircle({ x: cx, y: badgeYTop - 49, size: 4.5, color: INDIGO });
  page.drawRectangle({
    x: cx - 2,
    y: badgeYTop - 58,
    width: 4,
    height: 8,
    color: INDIGO,
  });

  // Headline + explanation
  center("This document is protected", 480, 24, bold, SLATE_900);
  center("It is encrypted and can only be opened with PickPDF,", 448, 13);
  center("where you will be asked for its password.", 430, 13);

  // File chip
  const chipText = originalName;
  const chipSize = 12;
  const chipW = regular.widthOfTextAtSize(chipText, chipSize) + 28;
  page.drawSvgPath(roundedRectPath(Math.min(chipW, cardW - 60), 26, 13), {
    x: cx - Math.min(chipW, cardW - 60) / 2,
    y: 404,
    color: rgb(0.949, 0.957, 1), // indigo-50
  });
  center(chipText, 386.5, chipSize, regular, INDIGO);

  // Divider
  page.drawLine({
    start: { x: cardX + 40, y: 356 },
    end: { x: cardX + cardW - 40, y: 356 },
    thickness: 1,
    color: SLATE_200,
  });

  // How to open
  center("HOW TO OPEN", 332, 10, bold, SLATE_500);
  center("1.  Get PickPDF — the private, local-first PDF editor", 308, 12, regular, SLATE_900);
  center("2.  Open this file in PickPDF (File > Open)", 288, 12, regular, SLATE_900);
  center("3.  Enter the password you were given", 268, 12, regular, SLATE_900);

  // Footer
  center("Encrypted with AES-256 (GCM) — the content of this file is", 130, 9.5);
  center("unreadable in any other PDF viewer.", 117, 9.5);
  center("PickPDF", 88, 11, bold, INDIGO);

  await doc.attach(payload, WRAPPER_ATTACHMENT, {
    mimeType: "application/octet-stream",
    description:
      "AES-256-GCM encrypted document. Open this file with PickPDF and enter its password.",
  });

  return doc.save();
}
