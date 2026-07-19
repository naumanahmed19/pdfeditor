import { useEffect, useRef, useState } from "react";
import { FileKey2, FileSignature, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tip } from "../ui/tooltip";
import type { CertIdentity } from "../../lib/signatures";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Sign with a digital certificate (.p12/.pfx): embeds an adbe.pkcs7.detached
 * (PKCS#7/CMS) signature over the whole file. The certificate password is
 * checked up front (identity preview), the actual signing runs through
 * applyBytesOp so the signed bytes become the document verbatim — Save then
 * writes them unchanged.
 */
export function SignModal({ open, onClose }: Props) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [certFile, setCertFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<CertIdentity | null>(null);
  const [identityErr, setIdentityErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [targetField, setTargetField] = useState("");
  const [emptyFields, setEmptyFields] = useState<string[]>([]);
  const [existingSigs, setExistingSigs] = useState(0);
  const [busy, setBusy] = useState(false);

  // Fresh document facts each time the dialog opens.
  useEffect(() => {
    if (!open || !app.docBytes) return;
    let alive = true;
    void import("../../lib/signatures").then(async (m) => {
      const [fields, sigs] = await Promise.all([
        m.listUnsignedSignatureFields(app.docBytes!),
        m.verifySignatures(app.docBytes!),
      ]);
      if (!alive) return;
      setEmptyFields(fields);
      setExistingSigs(sigs.length);
    });
    return () => {
      alive = false;
    };
  }, [open, app.docBytes, app.docVersion]);

  // Live identity preview once a certificate and password are present.
  useEffect(() => {
    setIdentity(null);
    setIdentityErr(null);
    if (!certFile || !password) return;
    let alive = true;
    const t = setTimeout(() => {
      void import("../../lib/signatures")
        .then((m) => m.readP12Identity(certFile.bytes, password))
        .then((id) => {
          if (alive) setIdentity(id);
        })
        .catch((err) => {
          if (alive) {
            setIdentityErr(err instanceof Error ? err.message : "Could not read the certificate.");
          }
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [certFile, password]);

  if (!open || !app.pdf) return null;

  const close = () => {
    setCertFile(null);
    setPassword("");
    setIdentity(null);
    setIdentityErr(null);
    setReason("");
    setLocation("");
    setTargetField("");
    onClose();
  };

  const pickFile = async (f: File) => {
    setCertFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };

  const sign = async () => {
    if (!certFile || !identity) return;
    if (existingSigs > 0) {
      const ok = await app.requestConfirm({
        title: "Existing signatures will break",
        message:
          `This document already carries ${existingSigs} digital signature${existingSigs > 1 ? "s" : ""}. ` +
          "Signing rewrites the file, so the existing signatures will show as invalid afterwards. Continue?",
        confirmLabel: "Sign anyway",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const opts = {
        p12: certFile.bytes,
        password,
        reason: reason.trim() || undefined,
        location: location.trim() || undefined,
        fieldName: targetField || undefined,
      };
      await app.applyBytesOp(async (b) => {
        const { signPdf } = await import("../../lib/signatures");
        return signPdf(b, opts);
      }, "Document signed");
      toast.info("Use Save to write the signed file to disk. Further edits invalidate the signature.");
      window.dispatchEvent(
        new CustomEvent("pdfwb:open-sidebar-panel", { detail: { panel: "signatures" } }),
      );
      close();
    } finally {
      setBusy(false);
    }
  };

  const canSign = !!certFile && !!identity && !busy && !app.activeProtected;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSignature className="h-4 w-4 text-muted-foreground" />
            Sign with certificate
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {app.activeProtected ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            This document is password-protected. Saving re-encrypts the file,
            which would break a digital signature — remove the protection first
            (File → Document security), sign, then protect a copy if needed.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border p-3">
              <p className="pb-2 text-sm font-medium">Certificate file (.p12 / .pfx)</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileKey2 className="h-3.5 w-3.5" />
                  {certFile ? "Change file" : "Choose file"}
                </Button>
                {certFile && (
                  <Tip label={certFile.name}>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {certFile.name}
                    </span>
                  </Tip>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".p12,.pfx,application/x-pkcs12"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void pickFile(f);
                }}
              />
              {certFile && (
                <div className="flex flex-col gap-1.5 pt-2">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Certificate password"
                    autoFocus
                  />
                  {identityErr && password && (
                    <p className="text-xs text-destructive">{identityErr}</p>
                  )}
                  {identity && (
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                      <span>
                        Sign as <b>{identity.commonName ?? "(no name)"}</b>
                        {identity.organization ? ` — ${identity.organization}` : ""}
                        {identity.selfSigned
                          ? ". Self-signed certificate: other viewers will show the identity as unverified."
                          : identity.issuer
                            ? `, issued by ${identity.issuer}.`
                            : "."}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="pb-2 text-sm font-medium">Details (optional)</p>
              <div className="flex flex-col gap-1.5">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason — e.g. I approve this document"
                />
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location — e.g. Berlin"
                />
                {emptyFields.length > 0 && (
                  <label className="flex flex-col gap-1 pt-1 text-xs text-muted-foreground">
                    Signature field
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                      value={targetField}
                      onChange={(e) => setTargetField(e.target.value)}
                    >
                      <option value="">Invisible signature (no field)</option>
                      {emptyFields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Pending edits are saved into the document first, then the whole
              file is signed (PKCS#7). Anything you change afterwards
              invalidates the signature until you sign again.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          {!app.activeProtected && (
            <Button size="sm" disabled={!canSign} onClick={() => void sign()}>
              <FileSignature className="h-3.5 w-3.5" />
              Sign document
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
