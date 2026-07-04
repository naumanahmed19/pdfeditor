import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      closeButton
      className="toaster group"
      position="bottom-right"
      visibleToasts={5}
      toastOptions={{
        classNames: {
          // pr-8 reserves room so text never runs under the inline close button.
          toast:
            "group toast group-[.toaster]:rounded-md group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-background group-[.toaster]:pr-8 group-[.toaster]:text-foreground group-[.toaster]:shadow-lg",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold",
          description: "group-[.toast]:text-xs group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:px-2.5 group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:px-2.5 group-[.toast]:text-muted-foreground",
          // Neutral background (no richColors) — color lives only on the type
          // icon. Sonner's icons use currentColor, so tint the icon wrapper.
          success: "[&_[data-icon]]:!text-emerald-600 dark:[&_[data-icon]]:!text-emerald-400",
          error: "[&_[data-icon]]:!text-red-600 dark:[&_[data-icon]]:!text-red-400",
          warning: "[&_[data-icon]]:!text-amber-500 dark:[&_[data-icon]]:!text-amber-400",
          info: "[&_[data-icon]]:!text-sky-600 dark:[&_[data-icon]]:!text-sky-400",
          // Move the close button from its floating top-left corner to inside
          // the toast, vertically centered on the right, as a plain icon.
          closeButton:
            "group-[.toast]:!left-auto group-[.toast]:!right-2 group-[.toast]:!top-1/2 group-[.toast]:!-translate-y-1/2 group-[.toast]:!border-transparent group-[.toast]:!bg-transparent group-[.toast]:!text-muted-foreground group-[.toast]:hover:!text-foreground",
        },
      }}
      {...props}
    />
  );
}
