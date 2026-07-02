import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function optionText(children: React.ReactNode) {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      return "";
    })
    .join("")
    .trim();
}

function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    if (child.type === "option") {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      const value = String(props.value ?? optionText(props.children));
      return [{ value, label: props.label || optionText(props.children) || value, disabled: props.disabled }];
    }
    if (child.type === "optgroup") {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
      return optionsFromChildren(props.children);
    }
    return [];
  });
}

function makeChangeEvent(value: string) {
  return {
    target: { value },
    currentTarget: { value },
  } as React.ChangeEvent<HTMLSelectElement>;
}

export const Select = React.forwardRef<
  HTMLButtonElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">
>(({ className, children, value, defaultValue, onChange, disabled, "aria-label": ariaLabel, ...props }, ref) => {
  const options = React.useMemo(() => optionsFromChildren(children), [children]);
  const fallbackValue = defaultValue === undefined ? options[0]?.value : String(defaultValue);
  const selectedValue = value === undefined ? fallbackValue : String(value);
  const selectedOption = options.find((option) => option.value === selectedValue) || options[0];
  const minWidthClass = className?.match(/(?:^|\s)(?:min-w-|w-)\[[^\s]+\]|(?:^|\s)(?:min-w|w)-[^\s]+/) ? "" : "min-w-40";

  return (
    <BaseSelect.Root
      value={selectedValue}
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onChange?.(makeChangeEvent(nextValue));
      }}
      modal={false}
    >
      <BaseSelect.Trigger
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          minWidthClass,
          className,
        )}
        data-name={props.name}
      >
        <BaseSelect.Value className="min-w-0 truncate">
          {() => selectedOption?.label || selectedValue}
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="h-4 w-4" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} align="start" className="z-50">
          <BaseSelect.Popup className="min-w-[var(--anchor-width)] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  className="flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[selected]:text-foreground"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <BaseSelect.ItemIndicator className="flex items-center justify-center">
                      <Check className="h-4 w-4" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <BaseSelect.ItemText className="truncate">{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
});

Select.displayName = "Select";
