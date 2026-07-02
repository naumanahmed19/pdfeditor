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
          toast:
            "group toast group-[.toaster]:rounded-md group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-lg",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold",
          description: "group-[.toast]:text-xs group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:px-2.5 group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:px-2.5 group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
