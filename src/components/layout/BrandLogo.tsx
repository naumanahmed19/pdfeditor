import { cn } from "../../lib/utils";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  markClassName?: string;
  showMark?: boolean;
  showWordmark?: boolean;
  variant?: "inline" | "asset";
  wordmarkClassName?: string;
};

export function BrandLogo({
  className,
  imageClassName,
  markClassName,
  showMark = true,
  showWordmark = true,
  variant = "inline",
  wordmarkClassName,
}: BrandLogoProps) {
  if (variant === "asset") {
    return (
      <div
        className={cn("inline-flex items-center justify-center", className)}
        aria-label="PickPDF"
      >
        <img
          src="/pickpdf-logo-light.svg"
          alt=""
          className={cn(
            "h-full w-full object-contain dark:hidden",
            imageClassName,
          )}
        />
        <img
          src="/pickpdf-logo.svg"
          alt=""
          className={cn(
            "hidden h-full w-full object-contain dark:block",
            imageClassName,
          )}
        />
      </div>
    );
  }

  const markWrapperCls = cn(
    "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[30px] border border-sidebar-border bg-sidebar shadow-sm",
    markClassName,
  );
  const markCls = "h-[82%] w-[82%] object-contain";

  return (
    <div className={cn("flex items-center gap-2", className)} aria-label="PickPDF">
      {showMark && (
        <span className={markWrapperCls} aria-hidden="true">
          <img
            src="/pickpdf-mark-light.svg"
            alt=""
            className={cn(markCls, "dark:hidden")}
          />
          <img
            src="/pickpdf-mark.svg"
            alt=""
            className={cn(markCls, "hidden dark:block")}
          />
        </span>
      )}
      {showWordmark && (
        <span
          style={{
            fontFamily: '"Dongle", Inter, ui-sans-serif, system-ui, sans-serif',
          }}
          className={cn(
            "whitespace-nowrap text-[1.35rem] font-bold leading-[0.72] text-foreground",
            wordmarkClassName,
          )}
        >
          Pick<span className="font-bold text-[#ff5a52]">PDF</span>
        </span>
      )}
    </div>
  );
}
