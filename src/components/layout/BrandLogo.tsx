import { cn } from "../../lib/utils";

type BrandLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
};

export function BrandLogo({
  className,
  markClassName,
  wordmarkClassName,
}: BrandLogoProps) {
  const markWrapperCls = cn(
    "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[30px] border border-sidebar-border bg-sidebar shadow-sm",
    markClassName,
  );
  const markCls = "h-[82%] w-[82%] object-contain";

  return (
    <div className={cn("flex items-center gap-2", className)} aria-label="PickPDF">
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
    </div>
  );
}
