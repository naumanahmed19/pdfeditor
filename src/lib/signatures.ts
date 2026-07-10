// Certificate-based (PKI) digital signatures.
//
// Signing: the user supplies a .p12/.pfx bundle; we embed an
// adbe.pkcs7.detached (PAdES-style CMS) signature — a /Sig dictionary whose
// /ByteRange covers the whole file except the /Contents hex gap. pdf-lib
// writes the document once with fixed-size placeholders, then the ByteRange
// numbers and the DER signature are patched into the saved bytes in place
// (offsets must not move after hashing, so no re-serialization afterwards).
//
// Verification runs entirely client-side against the exact in-memory file
// bytes: digest over the ByteRange, signature over the signed attributes,
// plus certificate validity window. We cannot reach the OS trust store from
// the browser, so identity is reported as "not verified against a trusted
// authority" rather than pretending otherwise.
//
// node-forge handles PKCS#12 parsing and CMS — RSA only; ECDSA-signed
// documents report status "unknown" instead of a false verdict.

import forge from "node-forge";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";

/** DER capacity reserved for the CMS blob (certificate chains included). */
const SIG_PLACEHOLDER_BYTES = 8192;

export interface SignatureInfo {
  fieldName: string;
  /** Overall verdict for THIS signature's signed revision. */
  status: "valid" | "modified" | "invalid" | "unknown";
  /** Human explanation of the verdict. */
  statusDetail: string;
  /** Signer common name (from the certificate, else /Name). */
  signerName: string | null;
  signerOrg: string | null;
  /** ISO string; signed signingTime attribute, else the /M entry. */
  signingTime: string | null;
  reason: string | null;
  location: string | null;
  /** ByteRange ends at EOF — false means the file gained revisions after
   *  this signature (its own revision may still verify as valid). */
  coversWholeDocument: boolean;
  certIssuer: string | null;
  certNotBefore: string | null;
  certNotAfter: string | null;
  /** Certificate window did not contain the (claimed) signing time. */
  certOutsideValidity: boolean;
  selfSigned: boolean;
  subFilter: string | null;
  digestAlgorithm: string | null;
}

export interface SignOptions {
  /** PKCS#12 (.p12/.pfx) file contents. */
  p12: Uint8Array;
  password: string;
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Existing EMPTY signature field to sign into (fully qualified name);
   *  omitted → an invisible signature field is added on page 1. */
  fieldName?: string;
}

export interface CertIdentity {
  commonName: string | null;
  organization: string | null;
  issuer: string | null;
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
}

// ---------------------------------------------------------------------------
// binary helpers (forge works in latin-1 "binary strings")

function bytesToBinary(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(
      String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      ),
    );
  }
  return parts.join("");
}

function binaryToHex(binary: string): string {
  let hex = "";
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/** Feed a byte range into a forge message digest without one giant string. */
function digestUpdate(md: forge.md.MessageDigest, bytes: Uint8Array) {
  const CHUNK = 0x10000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    md.update(bytesToBinary(bytes.subarray(i, i + CHUNK)));
  }
}

/** Find `pattern` (ASCII) in `haystack`, from `from`. -1 when absent. */
function indexOfBytes(haystack: Uint8Array, pattern: string, from = 0): number {
  const first = pattern.charCodeAt(0);
  outer: for (let i = from; i <= haystack.length - pattern.length; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < pattern.length; j++) {
      if (haystack[i + j] !== pattern.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function pdfDateString(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}'${p(abs % 60)}'`
  );
}

/** Parse D:YYYYMMDDHHmmSS±HH'mm' (every part after the year optional). */
function parsePdfDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?/.exec(
    s,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, se, tz, tzh, tzm] = m;
  let iso = `${y}-${mo ?? "01"}-${d ?? "01"}T${h ?? "00"}:${mi ?? "00"}:${se ?? "00"}`;
  if (tz === "Z" || !tz) iso += "Z";
  else iso += `${tz}${tzh ?? "00"}:${tzm ?? "00"}`;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// PKCS#12

function parseP12(p12Bytes: Uint8Array, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(bytesToBinary(p12Bytes)),
    );
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/mac|hmac|password|integrity/i.test(msg)) {
      throw new Error("Wrong certificate password.");
    }
    throw new Error(
      "Could not read the certificate file — it may use an unsupported " +
        "algorithm (only RSA certificates are supported) or be corrupted.",
    );
  }

  const shrouded =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? [];
  const plain =
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ??
    [];
  const key = (shrouded[0] ?? plain[0])?.key as
    | forge.pki.rsa.PrivateKey
    | undefined;
  if (!key || !(key as { n?: unknown }).n) {
    throw new Error(
      "No usable private key in the file — only RSA certificates are supported.",
    );
  }

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ??
    [];
  const certs = certBags
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (certs.length === 0) {
    throw new Error("No certificate found in the file.");
  }

  // The signer certificate is the one matching the private key.
  const cert =
    certs.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return pub?.n && key.n.compareTo(pub.n) === 0;
    }) ?? certs[0];
  const chain = [cert, ...certs.filter((c) => c !== cert)];
  return { key, cert, chain };
}

function subjectField(cert: forge.pki.Certificate, name: string): string | null {
  const f = cert.subject.getField(name) as { value?: string } | null;
  return f?.value ?? null;
}

function issuerLabel(cert: forge.pki.Certificate): string | null {
  const f =
    (cert.issuer.getField("CN") as { value?: string } | null) ??
    (cert.issuer.getField("O") as { value?: string } | null);
  return f?.value ?? null;
}

function isSelfSigned(cert: forge.pki.Certificate): boolean {
  try {
    return cert.isIssuer(cert);
  } catch {
    return false;
  }
}

/** Peek at a .p12/.pfx so the sign dialog can show who would sign. */
export async function readP12Identity(
  p12: Uint8Array,
  password: string,
): Promise<CertIdentity> {
  const { cert } = parseP12(p12, password);
  return {
    commonName: subjectField(cert, "CN"),
    organization: subjectField(cert, "O"),
    issuer: issuerLabel(cert),
    notBefore: cert.validity.notBefore.toISOString(),
    notAfter: cert.validity.notAfter.toISOString(),
    selfSigned: isSelfSigned(cert),
  };
}

// ---------------------------------------------------------------------------
// AcroForm traversal (low-level: pdf-lib's typed form API skips /Sig values)

interface SigFieldHit {
  name: string;
  dict: PDFDict;
  value: PDFDict | null;
}

function walkFields(doc: PDFDocument): SigFieldHit[] {
  const out: SigFieldHit[] = [];
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fields = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!fields) return out;

  const visit = (ref: unknown, prefix: string, inheritedFT: string | null) => {
    const dict =
      ref instanceof PDFRef
        ? doc.context.lookupMaybe(ref, PDFDict)
        : ref instanceof PDFDict
          ? ref
          : undefined;
    if (!dict) return;
    const t = dict.get(PDFName.of("T"));
    const partial =
      t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : "";
    const name = prefix ? (partial ? `${prefix}.${partial}` : prefix) : partial;
    const ftName = dict.get(PDFName.of("FT"));
    const ft =
      ftName instanceof PDFName ? ftName.decodeText() : inheritedFT;
    const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
    const hasFieldKids =
      kids &&
      kids.asArray().some((k) => {
        const kd =
          k instanceof PDFRef ? doc.context.lookupMaybe(k, PDFDict) : undefined;
        return kd?.get(PDFName.of("T")) !== undefined;
      });
    if (kids && hasFieldKids) {
      for (const k of kids.asArray()) visit(k, name, ft);
      return;
    }
    if (ft === "Sig") {
      const v = dict.get(PDFName.of("V"));
      const value =
        v instanceof PDFRef
          ? (doc.context.lookupMaybe(v, PDFDict) ?? null)
          : v instanceof PDFDict
            ? v
            : null;
      out.push({ name: name || "(unnamed)", dict, value });
    }
  };

  for (const f of fields.asArray()) visit(f, "", null);
  return out;
}

/** Names of empty signature fields the user could sign into. */
export async function listUnsignedSignatureFields(
  bytes: Uint8Array,
): Promise<string[]> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return walkFields(doc)
      .filter((f) => !f.value)
      .map((f) => f.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Signing

export async function signPdf(
  bytes: Uint8Array,
  opts: SignOptions,
): Promise<Uint8Array> {
  const { key, cert, chain } = parseP12(opts.p12, opts.password);
  const now = new Date();

  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  // --- signature value dictionary with fixed-size placeholders -------------
  const byteRangePlaceholder = PDFName.of("**********");
  const contentsPlaceholder = PDFHexString.of(
    "0".repeat(SIG_PLACEHOLDER_BYTES * 2),
  );
  const signerName = subjectField(cert, "CN") ?? subjectField(cert, "O");
  const sigEntries: Record<string, string | PDFObject> = {
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: doc.context.obj([
      PDFNumber.of(0),
      byteRangePlaceholder,
      byteRangePlaceholder,
      byteRangePlaceholder,
    ]),
    Contents: contentsPlaceholder,
    M: PDFString.of(pdfDateString(now)),
  };
  if (signerName) sigEntries.Name = PDFString.of(signerName);
  if (opts.reason) sigEntries.Reason = PDFString.of(opts.reason);
  if (opts.location) sigEntries.Location = PDFString.of(opts.location);
  if (opts.contactInfo) sigEntries.ContactInfo = PDFString.of(opts.contactInfo);
  const sigDict = doc.context.obj(sigEntries) as PDFDict;
  const sigRef = doc.context.register(sigDict);

  // --- attach to a field ----------------------------------------------------
  const form = doc.getForm();
  const acroDict = (form as unknown as { acroForm: { dict: PDFDict; addField: (r: PDFRef) => void } })
    .acroForm;
  const existing = walkFields(doc);

  if (opts.fieldName) {
    const target = existing.find((f) => f.name === opts.fieldName);
    if (!target) throw new Error(`Signature field "${opts.fieldName}" not found.`);
    if (target.value) {
      throw new Error(`Signature field "${opts.fieldName}" is already signed.`);
    }
    target.dict.set(PDFName.of("V"), sigRef);
    // A signed field must not stay interactive-editable.
    target.dict.set(PDFName.of("Ff"), PDFNumber.of(1));
  } else {
    const used = new Set(existing.map((f) => f.name));
    let n = 1;
    while (used.has(`Signature${n}`)) n++;
    const page = doc.getPage(0);
    const widget = doc.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFHexString.fromText(`Signature${n}`),
      V: sigRef,
      Rect: [0, 0, 0, 0],
      // Print | Hidden: the invisible-signature convention.
      F: 132,
      P: page.ref,
      Ff: 1,
    }) as PDFDict;
    const wRef = doc.context.register(widget);
    const annots =
      page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ??
      (() => {
        const a = doc.context.obj([]) as PDFArray;
        page.node.set(PDFName.of("Annots"), a);
        return a;
      })();
    annots.push(wRef);
    acroDict.addField(wRef);
  }
  // SignaturesExist | AppendOnly
  acroDict.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));

  // --- write once, then patch offsets in place ------------------------------
  const saved = await doc.save({ useObjectStreams: false });

  const contentsPattern = "<" + "0".repeat(SIG_PLACEHOLDER_BYTES * 2) + ">";
  const contentsStart = indexOfBytes(saved, contentsPattern);
  if (contentsStart < 0) throw new Error("Signature placeholder not found.");
  const contentsEnd = contentsStart + contentsPattern.length;

  // The /ByteRange array immediately serving this /Contents is the last one
  // before it (entries were inserted in that order).
  let brKey = -1;
  for (let i = indexOfBytes(saved, "/ByteRange"); i !== -1 && i < contentsStart; ) {
    brKey = i;
    i = indexOfBytes(saved, "/ByteRange", i + 1);
  }
  if (brKey < 0) throw new Error("ByteRange placeholder not found.");
  const brOpen = indexOfBytes(saved, "[", brKey);
  const brClose = indexOfBytes(saved, "]", brOpen);
  if (brOpen < 0 || brClose < 0 || brOpen > contentsStart) {
    throw new Error("ByteRange placeholder not found.");
  }

  const byteRange = [
    0,
    contentsStart,
    contentsEnd,
    saved.length - contentsEnd,
  ];
  const brText = `[ ${byteRange.join(" ")} ]`;
  const brSlot = brClose + 1 - brOpen;
  if (brText.length > brSlot) throw new Error("ByteRange overflow.");
  const brPadded = brText + " ".repeat(brSlot - brText.length);
  for (let i = 0; i < brSlot; i++) {
    saved[brOpen + i] = brPadded.charCodeAt(i);
  }

  // --- CMS SignedData over the two ranges -----------------------------------
  const signedData =
    bytesToBinary(saved.subarray(byteRange[0], byteRange[0] + byteRange[1])) +
    bytesToBinary(saved.subarray(byteRange[2], byteRange[2] + byteRange[3]));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(signedData);
  for (const c of chain) p7.addCertificate(c);
  p7.addSigner({
    key: key as unknown as string,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now as unknown as string },
    ],
  });
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  if (der.length > SIG_PLACEHOLDER_BYTES) {
    throw new Error(
      "Signature too large for the reserved space (certificate chain too big).",
    );
  }
  const hex = binaryToHex(der).padEnd(SIG_PLACEHOLDER_BYTES * 2, "0");
  for (let i = 0; i < hex.length; i++) {
    saved[contentsStart + 1 + i] = hex.charCodeAt(i);
  }

  return saved;
}

// ---------------------------------------------------------------------------
// Verification

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

const DIGEST_BY_OID: Record<string, { name: string; make: () => forge.md.MessageDigest }> = {
  "1.3.14.3.2.26": { name: "SHA-1", make: () => forge.md.sha1.create() },
  "2.16.840.1.101.3.4.2.1": { name: "SHA-256", make: () => forge.md.sha256.create() },
  "2.16.840.1.101.3.4.2.2": { name: "SHA-384", make: () => forge.md.sha384.create() },
  "2.16.840.1.101.3.4.2.3": { name: "SHA-512", make: () => forge.md.sha512.create() },
};

function pdfTextOf(obj: unknown): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try {
      return obj.decodeText();
    } catch {
      return null;
    }
  }
  return null;
}

function sigBytesOf(obj: unknown): Uint8Array | null {
  if (obj instanceof PDFHexString || obj instanceof PDFString) {
    try {
      return obj.asBytes();
    } catch {
      return null;
    }
  }
  return null;
}

export async function verifySignatures(
  bytes: Uint8Array,
): Promise<SignatureInfo[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    return [];
  }

  const signed = walkFields(doc).filter((f) => f.value);
  return signed.map((f) => verifyOne(bytes, f));
}

function verifyOne(bytes: Uint8Array, field: SigFieldHit): SignatureInfo {
  const v = field.value!;
  const subFilterName = v.get(PDFName.of("SubFilter"));
  const info: SignatureInfo = {
    fieldName: field.name,
    status: "unknown",
    statusDetail: "",
    signerName: pdfTextOf(v.get(PDFName.of("Name"))),
    signerOrg: null,
    signingTime:
      parsePdfDate(pdfTextOf(v.get(PDFName.of("M"))))?.toISOString() ?? null,
    reason: pdfTextOf(v.get(PDFName.of("Reason"))),
    location: pdfTextOf(v.get(PDFName.of("Location"))),
    coversWholeDocument: false,
    certIssuer: null,
    certNotBefore: null,
    certNotAfter: null,
    certOutsideValidity: false,
    selfSigned: false,
    subFilter:
      subFilterName instanceof PDFName ? subFilterName.decodeText() : null,
    digestAlgorithm: null,
  };

  try {
    // --- ByteRange sanity ---------------------------------------------------
    const brArr = v.lookupMaybe(PDFName.of("ByteRange"), PDFArray);
    const br = brArr
      ?.asArray()
      .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
    if (!br || br.length !== 4 || br.some((n) => !Number.isInteger(n) || n < 0)) {
      info.statusDetail = "Missing or malformed ByteRange.";
      return info;
    }
    const [o1, l1, o2, l2] = br;
    if (o1 + l1 > bytes.length || o2 + l2 > bytes.length || o2 < o1 + l1) {
      info.status = "modified";
      info.statusDetail =
        "The signed byte range no longer matches the file — the document was changed after signing.";
      return info;
    }
    info.coversWholeDocument = o1 === 0 && o2 + l2 === bytes.length;

    const contents = sigBytesOf(v.get(PDFName.of("Contents")));
    if (!contents) {
      info.statusDetail = "Missing signature contents.";
      return info;
    }

    if (
      info.subFilter &&
      info.subFilter !== "adbe.pkcs7.detached" &&
      info.subFilter !== "ETSI.CAdES.detached"
    ) {
      info.statusDetail = `Signature type "${info.subFilter}" is not supported for verification.`;
      return info;
    }

    // --- parse CMS ------------------------------------------------------------
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(bytesToBinary(contents)),
      { parseAllBytes: false } as unknown as boolean,
    );
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData;
    const raw = (p7 as unknown as { rawCapture: Record<string, unknown> })
      .rawCapture;
    const certs = (p7.certificates ?? []) as forge.pki.Certificate[];

    // The signer is the leaf: a certificate that issued no other in the bag.
    const cert =
      certs.find((c) => !certs.some((o) => o !== c && safeIsIssuer(o, c))) ??
      certs[0];
    if (cert) {
      info.signerName = subjectField(cert, "CN") ?? info.signerName;
      info.signerOrg = subjectField(cert, "O");
      info.certIssuer = issuerLabel(cert);
      info.certNotBefore = cert.validity.notBefore.toISOString();
      info.certNotAfter = cert.validity.notAfter.toISOString();
      info.selfSigned = isSelfSigned(cert);
    }

    const digestOid = forge.asn1.derToOid(
      raw.digestAlgorithm as forge.util.ByteStringBuffer | string,
    );
    const digestSpec = DIGEST_BY_OID[digestOid];
    if (!digestSpec) {
      info.statusDetail = `Unsupported digest algorithm (${digestOid}).`;
      return info;
    }
    info.digestAlgorithm = digestSpec.name;

    // --- digest of the signed byte ranges --------------------------------------
    const contentMd = digestSpec.make();
    digestUpdate(contentMd, bytes.subarray(o1, o1 + l1));
    digestUpdate(contentMd, bytes.subarray(o2, o2 + l2));
    const contentDigest = contentMd.digest().getBytes();

    const signature = raw.signature as string;
    const attrs = raw.authenticatedAttributes as forge.asn1.Asn1[] | undefined;

    if (attrs && attrs.length) {
      // messageDigest attribute must equal the computed content digest…
      let claimed: string | null = null;
      let signingTime: Date | null = null;
      for (const attr of attrs) {
        const parts = attr.value as forge.asn1.Asn1[];
        const oid = forge.asn1.derToOid(
          (parts[0] as { value: string }).value,
        );
        const valueSet = parts[1] as { value: forge.asn1.Asn1[] };
        const first = valueSet.value?.[0] as { value: string } | undefined;
        if (oid === OID_MESSAGE_DIGEST && first) claimed = first.value;
        if (oid === OID_SIGNING_TIME && first) {
          try {
            signingTime = forge.asn1.utcTimeToDate(first.value);
          } catch {
            /* leave /M */
          }
        }
      }
      if (signingTime) info.signingTime = signingTime.toISOString();
      if (claimed === null) {
        info.statusDetail = "Signed attributes lack a message digest.";
        return info;
      }
      if (claimed !== contentDigest) {
        info.status = "modified";
        info.statusDetail =
          "The document content does not match what was signed — it was altered after signing.";
        return info;
      }
      // …and the signature itself covers the DER of the signed attributes.
      const set = forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.SET,
        true,
        attrs,
      );
      const attrMd = digestSpec.make();
      attrMd.update(forge.asn1.toDer(set).getBytes());
      if (!rsaVerify(cert, attrMd.digest().getBytes(), signature)) {
        info.status = "invalid";
        info.statusDetail =
          "The cryptographic signature does not verify against the signer's certificate.";
        return info;
      }
    } else {
      // No signed attributes: the signature is directly over the content digest.
      if (!rsaVerify(cert, contentDigest, signature)) {
        info.status = "invalid";
        info.statusDetail =
          "The signature does not verify — the document was altered after signing, or the signature is corrupt.";
        return info;
      }
    }

    // --- verdict ----------------------------------------------------------------
    if (cert) {
      const at = info.signingTime ? new Date(info.signingTime) : new Date();
      info.certOutsideValidity =
        at < cert.validity.notBefore || at > cert.validity.notAfter;
    }
    info.status = "valid";
    info.statusDetail = info.coversWholeDocument
      ? "The signed content is intact and unchanged since signing."
      : "This signature is valid for an earlier revision — the document gained changes after it was signed.";
    return info;
  } catch (err) {
    info.status = "unknown";
    info.statusDetail =
      "Could not verify this signature — it may use an algorithm we don't support (e.g. ECDSA): " +
      (err instanceof Error ? err.message : "parse error");
    return info;
  }
}

function safeIsIssuer(
  child: forge.pki.Certificate,
  parent: forge.pki.Certificate,
): boolean {
  try {
    return child.isIssuer(parent);
  } catch {
    return false;
  }
}

function rsaVerify(
  cert: forge.pki.Certificate | undefined,
  digest: string,
  signature: string,
): boolean {
  if (!cert) return false;
  try {
    const pub = cert.publicKey as forge.pki.rsa.PublicKey;
    return pub.verify(digest, signature);
  } catch {
    return false;
  }
}
