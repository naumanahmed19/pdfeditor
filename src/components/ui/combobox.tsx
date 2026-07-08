import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "../../lib/utils";

export interface ComboboxOption {
  value: string;
  label?: string;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Combobox({
  value,
  options,
  onValueChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No options found.",
  allowCustom = false,
  className,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((option) => option.value === value);
  const displayValue = selected?.value ?? value;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? options.filter((option) =>
        `${option.label ?? ""} ${option.value}`.toLowerCase().includes(normalizedQuery),
      )
    : options;
  const customValue = query.trim();
  const canUseCustom =
    allowCustom &&
    customValue.length > 0 &&
    !options.some((option) => option.value === customValue);

  const commit = (nextValue: string) => {
    onValueChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm font-normal shadow-none transition-colors hover:bg-accent hover:text-accent-foreground",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate text-left", !displayValue && "text-muted-foreground")}>
          {displayValue || placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="end" className={cn("w-80 p-0", className)}>
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (filtered[0]) {
                commit(filtered[0].value);
              } else if (canUseCustom) {
                commit(customValue);
              }
            }}
            placeholder={searchPlaceholder}
            autoFocus
            className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => commit(option.value)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0 flex-1">
                {option.label && option.label !== option.value && (
                  <span className="block text-xs font-medium">{option.label}</span>
                )}
                <span className="block truncate text-muted-foreground">
                  {option.value}
                </span>
              </span>
            </button>
          ))}
          {canUseCustom && (
            <button
              type="button"
              onClick={() => commit(customValue)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
            >
              <span className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">Use custom value</span>
                <span className="block truncate text-muted-foreground">{customValue}</span>
              </span>
            </button>
          )}
          {filtered.length === 0 && !canUseCustom && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
