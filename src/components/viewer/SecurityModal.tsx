import { useState } from "react";
import { Lock, LockOpen, ShieldCheck, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { PDF_PERMISSIONS } from "../../lib/pdfium";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * User-facing permission choices → OR'd PDF permission bits. Text access for
 * screen readers (512) is always granted, like Acrobat's default.
 */
const PERMISSION_GROUPS = [
  {
    key: "print",
    label: "Allow printing",
    bits: PDF_PERMISSIONS.print | PDF_PERMISSIONS.printHighQuality,
  },
  {
    key: "copy",
    label: "Allow copying text & images",
    bits: PDF_PERMISSIONS.copyContents,
  },
  {
    key: "edit",
    label: "Allow editing & annotating",
    bits:
      PDF_PERMISSIONS.modifyContents |
      PDF_PERMISSIONS.modifyAnnotations |
      PDF_PERMISSIONS.assembleDocument,
  },
  {
    key: "forms",
    label: "Allow filling form fields",
    bits: PDF_PERMISSIONS.fillForms,
  },
] as const;

/**
 * Document security dialog.
 *
 * Unprotected document → protect form with the REAL two-password model:
 *  - "Require a password to open" (user password): AES-256; nobody opens
 *    the file without it.
 *  - "Restrict what others may do" (permissions/owner password): print/copy/
 *    edit/form flags that compliant viewers (including PickPDF) enforce for
 *    anyone who opens the file without the permissions password.
 *  Either section works alone; together the two passwords MUST differ,
 *  otherwise whoever opens the file automatically holds owner rights and the
 *  restrictions are void (the form enforces this).
 *
 * Protected document → status view: what's restricted, unlock with the
 * permissions password, or remove protection (owner rights required).
 */
export function SecurityModal({ open, onClose }: Props) {
  const app = useApp();
  // Protect form state
  const [useOpenPw, setUseOpenPw] = useState(true);
  const [openPw, setOpenPw] = useState("");
  const [openPw2, setOpenPw2] = useState("");
  const [pickpdfOnly, setPickpdfOnly] = useState(false);
  const [useRestrict, setUseRestrict] = useState(false);
  const [ownerPw, setOwnerPw] = useState("");
  const [ownerPw2, setOwnerPw2] = useState("");
  const [allowed, setAllowed] = useState<Record<string, boolean>>({
    print: true,
    copy: true,
    edit: false,
    forms: true,
  });
  // Status view state
  const [unlockPw, setUnlockPw] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open || !app.pdf) return null;

  const openMismatch = openPw2.length > 0 && openPw !== openPw2;
  const ownerMismatch = ownerPw2.length > 0 && ownerPw !== ownerPw2;
  // Under a PickPDF lock the restrict section is hidden and ignored.
  const restrictActive = useRestrict && !pickpdfOnly;
  const samePw =
    useOpenPw && restrictActive && openPw.length > 0 && openPw === ownerPw;

  const openOk = !useOpenPw || (openPw.length > 0 && openPw === openPw2);
  const restrictOk = !restrictActive || (ownerPw.length > 0 && ownerPw === ownerPw2);
  const canProtect =
    (useOpenPw || restrictActive) && openOk && restrictOk && !samePw && !busy;

  const close = () => {
    setOpenPw("");
    setOpenPw2("");
    setOwnerPw("");
    setOwnerPw2("");
    setUnlockPw("");
    onClose();
  };

  const protect = async () => {
    const permissions: number = restrictActive
      ? PERMISSION_GROUPS.reduce<number>(
          (acc, g) => (allowed[g.key] ? acc | g.bits : acc),
          PDF_PERMISSIONS.extractForAccessibility,
        )
      : PDF_PERMISSIONS.allowAll;
    setBusy(true);
    try {
      await app.protectDocument({
        userPassword: useOpenPw ? openPw : "",
        // Without restrictions there's nothing the owner password guards, so
        // reuse the open password rather than inventing a second secret.
        ownerPassword: restrictActive ? ownerPw : openPw,
        permissions,
        pickpdfOnly: useOpenPw && pickpdfOnly,
      });
      close();
    } finally {
      setBusy(false);
    }
  };

  const removeProtection = async () => {
    setBusy(true);
    try {
      await app.removePassword();
      close();
    } finally {
      setBusy(false);
    }
  };

  const perms = app.docPermissions;

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
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Document security
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {app.activeProtected ? (
          /* ---------- Status view for a protected document ---------- */
          <>
            <div className="flex flex-col gap-2 text-sm">
              {app.activeWrapped ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  Locked to PickPDF — other viewers show a notice page; the
                  content is AES-256-GCM encrypted inside. Saving keeps the
                  lock.
                </p>
              ) : app.activeEncrypted ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  This document is encrypted
                  {app.pdf && app.docPermissions.restricted
                    ? " and restricts what you may do:"
                    : ". You hold full permissions."}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  Password-protected — the open copy stays editable, and saving
                  writes the encrypted file (AES-256) to disk.
                </p>
              )}
              {perms.restricted && (
                <ul className="ml-1 flex flex-col gap-1 text-xs">
                  <PermRow ok={perms.print} label="Printing" />
                  <PermRow ok={perms.copy} label="Copying text & images" />
                  <PermRow ok={perms.modify || perms.annotate} label="Editing & annotating" />
                  <PermRow ok={perms.fillForms} label="Filling form fields" />
                </ul>
              )}
              {perms.restricted && (
                <div className="pt-1">
                  <p className="pb-1 text-xs font-medium text-muted-foreground">
                    Unlock full access with the permissions password
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={unlockPw}
                      onChange={(e) => setUnlockPw(e.target.value)}
                      placeholder="Permissions password"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        void app.unlockPermissions(unlockPw).then((ok) => {
                          if (ok) setUnlockPw("");
                        });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void app.unlockPermissions(unlockPw).then((ok) => {
                          if (ok) setUnlockPw("");
                        });
                      }}
                    >
                      Unlock
                    </Button>
                  </div>
                </div>
              )}
              <p className="pt-1 text-xs text-muted-foreground">
                Removing protection decrypts the open copy (owner rights
                required) — use <b>Save</b> afterwards to write the unlocked
                file to disk.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void removeProtection()}>
                <LockOpen className="h-3.5 w-3.5" />
                Remove protection
              </Button>
            </div>
          </>
        ) : (
          /* ---------- Protect form for an unprotected document ---------- */
          <>
            <div className="flex flex-col gap-3">
              {/* Open password */}
              <div className="rounded-lg border p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={useOpenPw}
                    onCheckedChange={(v) => {
                      setUseOpenPw(!!v);
                      // Lock-to-PickPDF needs an open password to wrap behind;
                      // don't leave it silently armed when that's turned off.
                      if (!v) setPickpdfOnly(false);
                    }}
                  />
                  Require a password to open
                </label>
                {useOpenPw && (
                  <div className="flex flex-col gap-1.5 pt-2">
                    <Input
                      type="password"
                      value={openPw}
                      onChange={(e) => setOpenPw(e.target.value)}
                      placeholder="Open password"
                      autoFocus
                    />
                    <Input
                      type="password"
                      value={openPw2}
                      onChange={(e) => setOpenPw2(e.target.value)}
                      placeholder="Confirm open password"
                    />
                    {openMismatch && (
                      <p className="text-xs text-destructive">Passwords don't match.</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      AES-256 encrypted — the file cannot be opened without it.
                    </p>
                    <label className="mt-1 flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={pickpdfOnly}
                        onCheckedChange={(v) => setPickpdfOnly(!!v)}
                      />
                      <span>
                        Lock to PickPDF
                        <span className="block text-xs font-normal text-muted-foreground">
                          Other PDF viewers show a professional notice page
                          instead of a password prompt — the content itself
                          travels encrypted inside and is unreadable anywhere
                          but PickPDF.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Permission restrictions — moot under a PickPDF lock (the
                  wrapper already makes the content unreadable elsewhere). */}
              {pickpdfOnly ? (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Locked to PickPDF — the content is already unreadable in other
                  viewers, so per-viewer print/copy/edit restrictions aren't
                  needed.
                </p>
              ) : (
              <div className="rounded-lg border p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={useRestrict}
                    onCheckedChange={(v) => setUseRestrict(!!v)}
                  />
                  Restrict what others may do
                </label>
                {useRestrict && (
                  <div className="flex flex-col gap-1.5 pt-2">
                    {PERMISSION_GROUPS.map((g) => (
                      <label
                        key={g.key}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={allowed[g.key]}
                          onCheckedChange={(v) =>
                            setAllowed((a) => ({ ...a, [g.key]: !!v }))
                          }
                        />
                        {g.label}
                      </label>
                    ))}
                    <Input
                      type="password"
                      className="mt-1"
                      value={ownerPw}
                      onChange={(e) => setOwnerPw(e.target.value)}
                      placeholder="Permissions password"
                    />
                    <Input
                      type="password"
                      value={ownerPw2}
                      onChange={(e) => setOwnerPw2(e.target.value)}
                      placeholder="Confirm permissions password"
                    />
                    {ownerMismatch && (
                      <p className="text-xs text-destructive">Passwords don't match.</p>
                    )}
                    {samePw && (
                      <p className="text-xs text-destructive">
                        The permissions password must differ from the open
                        password — otherwise anyone who opens the file can lift
                        the restrictions.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Enforced by compliant viewers (including this one) for
                      anyone without this password. Keep it to yourself.
                    </p>
                  </div>
                )}
              </div>
              )}

              <p className="text-xs text-muted-foreground">
                {app.activeHasHandle
                  ? "The protected file is written to disk; the copy open here stays unlocked until you close it."
                  : "A protected copy will be downloaded."}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canProtect} onClick={() => void protect()}>
                <Lock className="h-3.5 w-3.5" />
                Protect{app.activeHasHandle ? " & save" : " & download"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PermRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? "text-green-600" : "text-destructive"}>
        {ok ? "✓" : "✕"}
      </span>
      {label}
      {!ok && <span className="text-muted-foreground">(not allowed)</span>}
    </li>
  );
}
