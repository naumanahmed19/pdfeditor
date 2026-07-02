import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

type Tab = "draw" | "type" | "upload";

const SIG_FONTS = [
  { cls: "font-signature-1", css: '"Segoe Script", "Brush Script MT", cursive' },
  { cls: "font-signature-2", css: '"Lucida Handwriting", "Brush Script MT", cursive' },
  { cls: "font-signature-3", css: '"Brush Script MT", "Segoe Script", cursive' },
];

export function SignatureModal() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("draw");

  if (!app.signatureModalOpen) return null;

  const useSignature = (dataUrl: string, save: boolean) => {
    const img = new Image();
    img.onload = () => {
      app.setPendingStamp({ dataUrl, aspect: img.height / img.width || 0.4 });
      if (save) app.addSignature(dataUrl);
      app.setSignatureModalOpen(false);
      if (!app.pdf) {
        toast.info("Open a PDF, then click on a page to place the signature.");
      } else {
        toast.info("Click on the page where you want to place the signature.");
      }
    };
    img.src = dataUrl;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => app.setSignatureModalOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-sm font-semibold">Insert signature</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => app.setSignatureModalOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="inline-flex rounded-md bg-muted p-0.5">
          {(["draw", "type", "upload"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 rounded-sm px-3 text-xs font-medium capitalize transition",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === "draw" && <DrawTab onUse={useSignature} />}
          {tab === "type" && <TypeTab onUse={useSignature} />}
          {tab === "upload" && <UploadTab onUse={useSignature} />}
        </div>

        {app.signatures.length > 0 && (
          <div className="pt-5">
            <p className="pb-2 text-xs font-medium text-muted-foreground">
              Saved signatures
            </p>
            <div className="grid grid-cols-3 gap-2">
              {app.signatures.map((s) => (
                <div
                  key={s.id}
                  className="group relative cursor-pointer rounded-md border bg-white p-2 hover:border-foreground/40"
                  onClick={() => useSignature(s.dataUrl, false)}
                >
                  <img
                    src={s.dataUrl}
                    alt="signature"
                    className="h-10 w-full object-contain"
                  />
                  <button
                    className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      app.removeSignature(s.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DrawTab({ onUse }: { onUse: (dataUrl: string, save: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#1e293b";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    hasInk.current = false;
  };

  const use = (save: boolean) => {
    const c = canvasRef.current;
    if (!c || !hasInk.current) {
      toast.error("Draw a signature first");
      return;
    }
    onUse(c.toDataURL("image/png"), save);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-40 w-full cursor-crosshair touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          hasInk.current = true;
          last.current = pos(e);
          try {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* synthetic pointers */
          }
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pos(e);
          const ctx = canvasRef.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="flex items-center justify-between pt-3">
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => use(false)}>
            Use once
          </Button>
          <Button size="sm" onClick={() => use(true)}>
            Save & use
          </Button>
        </div>
      </div>
    </div>
  );
}

function TypeTab({ onUse }: { onUse: (dataUrl: string, save: boolean) => void }) {
  const [name, setName] = useState("");
  const [fontIdx, setFontIdx] = useState(0);

  const render = (save: boolean) => {
    if (!name.trim()) {
      toast.error("Type your name first");
      return;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = `56px ${SIG_FONTS[fontIdx].css}`;
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(name).width) + 40;
    canvas.width = width;
    canvas.height = 110;
    const ctx2 = canvas.getContext("2d")!;
    ctx2.font = font;
    ctx2.fillStyle = "#1e293b";
    ctx2.textBaseline = "middle";
    ctx2.fillText(name, 20, 55);
    onUse(canvas.toDataURL("image/png"), save);
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name"
      />
      <div className="flex flex-col gap-1.5">
        {SIG_FONTS.map((f, i) => (
          <button
            key={i}
            onClick={() => setFontIdx(i)}
            className={cn(
              "rounded-md border bg-white px-3 py-2 text-left text-2xl text-slate-800",
              f.cls,
              fontIdx === i ? "border-foreground/60 ring-1 ring-foreground/40" : "border-border",
            )}
          >
            {name || "Your Name"}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => render(false)}>
          Use once
        </Button>
        <Button size="sm" onClick={() => render(true)}>
          Save & use
        </Button>
      </div>
    </div>
  );
}

function UploadTab({ onUse }: { onUse: (dataUrl: string, save: boolean) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-32 cursor-pointer items-center justify-center rounded-md border-2 border-dashed bg-muted/40 text-sm text-muted-foreground hover:border-foreground/40">
        {dataUrl ? (
          <img src={dataUrl} alt="signature" className="max-h-28 object-contain" />
        ) : (
          "Click to choose a PNG or JPG of your signature"
        )}
        <input
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => setDataUrl(reader.result as string);
            reader.readAsDataURL(f);
          }}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!dataUrl}
          onClick={() => dataUrl && onUse(dataUrl, false)}
        >
          Use once
        </Button>
        <Button size="sm" disabled={!dataUrl} onClick={() => dataUrl && onUse(dataUrl, true)}>
          Save & use
        </Button>
      </div>
    </div>
  );
}
