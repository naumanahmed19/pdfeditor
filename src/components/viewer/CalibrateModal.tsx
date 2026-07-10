import { useEffect, useState } from "react";
import { Ruler, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { MEASURE_UNITS, formatMeasure, formatScale } from "../../lib/measure";

/** "This line is ___ units" dialog, opened after the calibration reference
 *  line is drawn. Sets the document's measure scale to entered / drawn-pt. */
export function CalibrateModal() {
  const app = useApp();
  const req = app.calibrateRequest;
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("m");

  // The component stays mounted between calibrations — reset per request,
  // seeding the unit from the current calibration.
  useEffect(() => {
    if (req) {
      setValue("");
      const current = app.measureScale?.unit;
      setUnit(current && current !== "pt" ? current : "m");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;

  const close = () => app.setCalibrateRequest(null);

  const apply = () => {
    const entered = Number(value);
    if (!Number.isFinite(entered) || entered <= 0) {
      toast.error("Enter the real-world length of the drawn line.");
      return;
    }
    if (req.ptLength <= 0) {
      toast.error("The calibration line has no length — draw it again.");
      close();
      return;
    }
    const scale = entered / req.ptLength;
    app.setMeasureScale(unit === "pt" && scale === 1 ? null : { scale, unit });
    close();
    toast.success(
      `Calibrated: 1 pt = ${formatScale(scale)} ${unit}. New and existing measurements now read in ${unit}.`,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-shell"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Ruler className="h-4 w-4" />
            Calibrate measurements
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="pb-3 text-xs text-muted-foreground">
          The line you drew is {formatMeasure(req.ptLength, "pt")} on the page.
          Enter its real-world length to set the document&apos;s scale.
        </p>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted-foreground">
            This line is
          </span>
          <Input
            autoFocus
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="length"
            aria-label="Known length"
            className="h-9 w-24"
          />
          <Select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
            className="h-9 w-20 min-w-20"
          >
            {MEASURE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply}>
            Set scale
          </Button>
        </div>
      </div>
    </div>
  );
}
