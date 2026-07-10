import { beforeAll, describe, expect, it } from "vitest";
import forge from "node-forge";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
} from "pdf-lib";
import {
  listUnsignedSignatureFields,
  readP12Identity,
  signPdf,
  verifySignatures,
} from "./signatures";

// A throwaway self-signed RSA identity, packed as .p12 exactly the way
// OpenSSL / Windows cert export would.
function makeP12(password: string, cn = "Test Signer") {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01a7";
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: cn },
    { name: "organizationName", value: "PickPDF Tests" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: "3des",
  });
  const der = forge.asn1.toDer(asn1).getBytes();
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return bytes;
}

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText("Signature test document", { x: 40, y: 200, size: 14 });
  return doc.save({ useObjectStreams: false });
}

/** Add an UNSIGNED /Sig widget the way the form designer does. */
async function makePdfWithEmptySigField(name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  const widget = doc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    T: PDFHexString.fromText(name),
    Rect: [50, 50, 200, 100],
    F: 4,
    P: page.ref,
  }) as PDFDict;
  const ref: PDFRef = doc.context.register(widget);
  const annots = doc.context.obj([ref]) as PDFArray;
  page.node.set(PDFName.of("Annots"), annots);
  (form as unknown as { acroForm: { addField: (r: PDFRef) => void } }).acroForm.addField(
    ref,
  );
  return doc.save({ useObjectStreams: false });
}

let p12: Uint8Array;

beforeAll(() => {
  p12 = makeP12("secret");
}, 60_000);

describe("readP12Identity", () => {
  it("reads the signer identity", async () => {
    const id = await readP12Identity(p12, "secret");
    expect(id.commonName).toBe("Test Signer");
    expect(id.organization).toBe("PickPDF Tests");
    expect(id.selfSigned).toBe(true);
  });

  it("rejects a wrong password", async () => {
    await expect(readP12Identity(p12, "nope")).rejects.toThrow(/password/i);
  });
});

describe("signPdf + verifySignatures roundtrip", () => {
  it("produces a signature that verifies as valid and intact", async () => {
    const pdf = await makePdf();
    const signed = await signPdf(pdf, {
      p12,
      password: "secret",
      reason: "Approval",
      location: "Test Suite",
    });

    const sigs = await verifySignatures(signed);
    expect(sigs).toHaveLength(1);
    const s = sigs[0];
    expect(s.status).toBe("valid");
    expect(s.coversWholeDocument).toBe(true);
    expect(s.signerName).toBe("Test Signer");
    expect(s.signerOrg).toBe("PickPDF Tests");
    expect(s.reason).toBe("Approval");
    expect(s.location).toBe("Test Suite");
    expect(s.selfSigned).toBe(true);
    expect(s.digestAlgorithm).toBe("SHA-256");
    expect(s.subFilter).toBe("adbe.pkcs7.detached");
    expect(s.signingTime).toBeTruthy();
    expect(s.certOutsideValidity).toBe(false);
  }, 30_000);

  it("flags a tampered document as modified", async () => {
    const signed = await signPdf(await makePdf(), { p12, password: "secret" });
    const tampered = signed.slice();
    // Flip a byte well inside the first signed range (PDF header area is
    // covered by the ByteRange).
    tampered[64] = tampered[64] === 0x41 ? 0x42 : 0x41;
    const sigs = await verifySignatures(tampered);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].status).toBe("modified");
  }, 30_000);

  it("keeps the signature valid but not whole-document after appended bytes", async () => {
    const signed = await signPdf(await makePdf(), { p12, password: "secret" });
    const appended = new Uint8Array(signed.length + 16);
    appended.set(signed);
    appended.set(new TextEncoder().encode("% later revision"), signed.length);
    const sigs = await verifySignatures(appended);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].status).toBe("valid");
    expect(sigs[0].coversWholeDocument).toBe(false);
  }, 30_000);

  it("rejects a wrong certificate password", async () => {
    await expect(
      signPdf(await makePdf(), { p12, password: "wrong" }),
    ).rejects.toThrow(/password/i);
  });
});

describe("existing signature fields", () => {
  it("lists unsigned fields and signs into a chosen one", async () => {
    const pdf = await makePdfWithEmptySigField("ApproverSignature");
    expect(await listUnsignedSignatureFields(pdf)).toEqual([
      "ApproverSignature",
    ]);

    const signed = await signPdf(pdf, {
      p12,
      password: "secret",
      fieldName: "ApproverSignature",
    });
    const sigs = await verifySignatures(signed);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].fieldName).toBe("ApproverSignature");
    expect(sigs[0].status).toBe("valid");
    // Now filled, so no longer offered as a target.
    expect(await listUnsignedSignatureFields(signed)).toEqual([]);
  }, 30_000);

  it("refuses to sign into an already-signed field", async () => {
    const pdf = await makePdfWithEmptySigField("Once");
    const signed = await signPdf(pdf, {
      p12,
      password: "secret",
      fieldName: "Once",
    });
    await expect(
      signPdf(signed, { p12, password: "secret", fieldName: "Once" }),
    ).rejects.toThrow(/already signed/i);
  }, 30_000);
});
