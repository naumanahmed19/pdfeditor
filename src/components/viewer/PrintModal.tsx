import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio";
import { parsePageRanges } from "../../lib/utils";

type RangeMode = "all" | "current" | "custom";
type ScaleMode = "actual" | "fit" | "custom";

/**
 * Print dialog: choose a page range (all / current / custom) and a scale
 * (actual size / fit / custom %), then hand a subset+scaled PDF to the
 * browser's native print flow via the store's `printWith`.
 */
export function PrintModal() {
  const app = useApp();
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customRange, setCustomRange] = useState("");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("fit");
  const [customScale, setCustomScale] = useState("100");
  const [busy, setBusy] = useState(false);

  // Reset to defaults each time the dialog opens.
  useEffect(() => {
    if (app.printModalOpen) {
      setRangeMode("all");
      setCustomRange(`${app.currentPage + 1}`);
      setScaleMode("fit");
      setCustomScale("100");
      setBusy(false);
    }
  }, [app.printModalOpen, app.currentPage]);

  useEffect(() => {
    if (!app.printModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") app.setPrintModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app.printModalOpen, app]);

  if (!app.printModalOpen) return null;

  const pageIndexes = (): number[] | null => {
    if (rangeMode === "all") return null;
    if (rangeMode === "current") return [app.currentPage];
    return parsePageRanges(customRange, app.numPages);
  };

  const scale = (): number => {
    // "fit" leaves scaling to the browser print dialog (scale 1 subset).
    if (scaleMode === "actual" || scaleMode === "fit") return 1;
    const pct = Number(customScale);
    return Number.isFinite(pct) && pct > 0 ? Math.min(4, Math.max(0.1, pct / 100)) : 1;
  };

  const submit = async () => {
    const idx = pageIndexes();
    if (rangeMode === "custom" && (!idx || idx.length === 0)) return;
    setBusy(true);
    try {
      await app.printWith(idx, scale());
    } finally {
      setBusy(false);
    }
  };

  const customCount =
    rangeMode === "custom" ? parsePageRanges(customRange, app.numPages).length : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={() => app.setPrintModalOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Printer className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Print</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => app.setPrintModalOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="pb-1.5 text-xs font-medium text-muted-foreground">Pages</p>
        <RadioGroup
          value={rangeMode}
          onValueChange={(v) => setRangeMode(v as RangeMode)}
          className="pb-4"
        >
          <Radio value="all">All ({app.numPages})</Radio>
          <Radio value="current">Current page ({app.currentPage + 1})</Radio>
          <div className="flex items-center gap-2">
            <Radio value="custom">Pages</Radio>
            <Input
              value={customRange}
              onFocus={() => setRangeMode("custom")}
              onChange={(e) => setCustomRange(e.target.value)}
              placeholder={`1-3, 5`}
              className="h-7 w-32 text-xs"
            />
          </div>
          {rangeMode === "custom" && (
            <p className="pl-6 text-xs text-muted-foreground">
              {customCount > 0 ? `${customCount} page(s) selected` : "Enter valid pages"}
            </p>
          )}
        </RadioGroup>

        <p className="pb-1.5 text-xs font-medium text-muted-foreground">Scale</p>
        <RadioGroup
          value={scaleMode}
          onValueChange={(v) => setScaleMode(v as ScaleMode)}
          className="pb-4"
        >
          <Radio value="fit">Fit to paper (browser default)</Radio>
          <Radio value="actual">Actual size (100%)</Radio>
          <div className="flex items-center gap-2">
            <Radio value="custom">Custom</Radio>
            <Input
              type="number"
              min={10}
              max={400}
              value={customScale}
              onFocus={() => setScaleMode("custom")}
              onChange={(e) => setCustomScale(e.target.value)}
              className="h-7 w-20 text-xs"
            />
            <span className="text-muted-foreground">%</span>
          </div>
        </RadioGroup>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => app.setPrintModalOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy || (rangeMode === "custom" && customCount === 0)}
            onClick={() => void submit()}
          >
            <Printer className="h-3.5 w-3.5" />
            {busy ? "Preparing…" : "Print"}
          </Button>
        </div>
      </div>
    </div>
  );
}
