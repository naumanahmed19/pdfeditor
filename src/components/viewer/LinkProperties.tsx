import { Trash2, X } from "lucide-react";
import type { LinkTarget, LinkTargetType } from "../../types";
import { LINK_TARGETS } from "../../lib/linktarget";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio";

/**
 * The "Link properties" picker: choose a target kind (URL / email / phone /
 * page) and enter its value. Shared by the area-link tool and text-box links.
 * `onDelete` is optional — omit it to hide the delete/remove action.
 */
export function LinkProperties({
  target,
  onChange,
  onClose,
  onDelete,
  deleteLabel = "Delete link",
}: {
  target: LinkTarget;
  onChange: (t: LinkTarget) => void;
  onClose: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Link properties</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <RadioGroup
        value={target.targetType}
        // Switching target kind clears the value — the single field is reused
        // for whichever kind is selected, so stale input never carries over.
        onValueChange={(v) =>
          onChange({ targetType: v as LinkTargetType, value: "" })
        }
      >
        {LINK_TARGETS.map((t) => (
          <div key={t.v} className="space-y-1">
            <Radio value={t.v}>{t.label}</Radio>
            {target.targetType === t.v && (
              <Input
                autoFocus
                type={t.type}
                value={target.value}
                onChange={(e) => onChange({ ...target, value: e.target.value })}
                placeholder={t.placeholder}
                min={t.v === "page" ? 1 : undefined}
                className="ml-6 h-8 w-[calc(100%-1.5rem)] text-sm"
                onKeyDown={(e) => e.key === "Enter" && onClose()}
              />
            )}
          </div>
        ))}
      </RadioGroup>
      <div className="flex items-center justify-between pt-0.5">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 text-sm font-medium text-destructive transition-colors hover:text-destructive/80"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleteLabel}
          </button>
        ) : (
          <span />
        )}
        <Button size="sm" variant="ghost" className="h-7 text-primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
