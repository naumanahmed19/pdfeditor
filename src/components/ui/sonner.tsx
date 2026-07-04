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
