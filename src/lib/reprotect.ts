// Re-protection recipes for documents that were STANDARD-ENCRYPTED when they
// were opened.
//
// Every edit path operates on an owner-authenticated plaintext working copy.
// The store captures a recipe when an encrypted document is opened and
// `protectForDisk` re-applies it to every subsequent save/download. A
// user-password-only document remains read-only until owner authentication.
//
// This module holds the pure decision logic (no PDFium/WASM imports) so it is
// unit-testable under plain node.
//
// Known, deliberate limitations of re-encryption:
//  - The existing encrypt path (EPDF_SetEncryption) always writes AES-256
//    (PDF 2.0 security handler, revision 6). If the original file used RC4 or
//    AES-128, saved copies are silently upgraded — protection is preserved,
//    the exact algorithm is not.
//  - Only the password the user actually typed is known. The "other" password
//    of the original user/owner pair cannot be recovered, so it cannot be
//    reproduced on saved copies (see the per-case notes below).

/** How to re-encrypt a document's bytes before they are written anywhere.
 *  Field semantics mirror EncryptOptions in pdfium.ts. */
export interface EncryptRecipe {
  kind: "encrypt";
  /** Password required to OPEN the re-encrypted file ("" = none). */
  userPassword: string;
  /** Password that unlocks full permissions on the re-encrypted file. */
  ownerPassword: string;
  /** OR'd PDF permission bits granted to the user-password holder. */
  permissions: number;
}

/** The PDF permission bits (spec table 22) the app round-trips: print(4),
 *  modify(8), copy(16), annotate(32), fill-forms(256), accessibility(512),
 *  assemble(1024), print-hq(2048). Equals PDF_PERMISSIONS.allowAll in
 *  pdfium.ts — duplicated as a literal so this module never pulls in the
 *  PDFium import graph. Raw FPDF_GetDocUserPermissions values have every
 *  reserved bit set to 1, so they must be masked before re-encrypting. */
export const PERMISSION_MASK = 3900;

/** What we learned about an encrypted document at open time. */
export interface OpenedEncryptedDoc {
  /** The password it was successfully opened with ("" = it opened without
   *  one, i.e. a restrictions-only file with an empty user password). */
  password: string;
  /** Whether that password granted owner (full-access) rights. */
  ownerUnlocked: boolean;
  /** Raw FPDF_GetDocUserPermissions bits (user-password permissions). */
  userPermissions: number;
}

/**
 * A fresh random owner secret for re-encrypted copies whose real owner
 * password is unknown. It is never shown to anyone and never stored beyond
 * the session, so the permission flags stay binding in every compliant viewer
 * (an owner password EQUAL to the user password would hand owner rights to
 * anyone who can open the file, silently voiding the restrictions).
 */
export function randomOwnerSecret(): string {
  const buf = new Uint8Array(18);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the re-encryption recipe for a document the user just opened, or null
 * when there is nothing to re-encrypt with (no password was entered — the
 * store then falls back to an explicit "saving removes protection" consent
 * prompt instead of ever stripping silently).
 *
 * Two cases, matching how PDFium granted access:
 *  - The entered password unlocked OWNER rights: reuse it as both passwords.
 *    Faithful for the common single-password document. If the original pair
 *    was distinct (the user typed the owner password), the original USER
 *    password is unknown and will no longer open saved copies — the file
 *    still requires the very password the user proved they hold.
 *  - The entered password granted USER rights only: keep it as the user
 *    password and pair it with a random owner secret so the original
 *    permission flags keep binding. The original OWNER password is unknown
 *    and will not unlock saved copies (the untouched original file still
 *    honors it).
 */
export function recipeForOpenedDoc(
  doc: OpenedEncryptedDoc,
  makeOwnerSecret: () => string = randomOwnerSecret,
): EncryptRecipe | null {
  if (!doc.password) return null;
  const permissions = doc.userPermissions & PERMISSION_MASK;
  return {
    kind: "encrypt",
    userPassword: doc.password,
    ownerPassword: doc.ownerUnlocked ? doc.password : makeOwnerSecret(),
    permissions,
  };
}

/**
 * Upgrade (or create) a recipe after the user unlocks owner rights in-session
 * with the REAL owner password: from now on saved copies reproduce the
 * original policy exactly — same owner password, same user password (the one
 * the document was opened with, possibly ""), same permission flags.
 */
export function recipeAfterOwnerUnlock(
  existing: EncryptRecipe | undefined,
  openPassword: string,
  ownerPassword: string,
  userPermissions: number,
): EncryptRecipe {
  return {
    kind: "encrypt",
    userPassword: existing?.userPassword ?? openPassword,
    ownerPassword,
    permissions: existing?.permissions ?? userPermissions & PERMISSION_MASK,
  };
}
