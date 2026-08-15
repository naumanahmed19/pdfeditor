import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { renderPageToCanvas, type PdfDoc, type PdfPage } from "../../lib/pdf";
import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";

interface PdfPagePreviewCardProps {
  pdf: PdfDoc;
  page: PdfPage | null;
  pageIndex: number;
  pageCount: number;
  scale: number;
  docVersion: number;
  onPageChange: (page: number) => void;
  testId: string;
  pageSize?: Pick<PdfPage, "width" | "height">;
  children?: React.ReactNode;
}

export function PdfPagePreviewCard({
  pdf,
  page,
  pageIndex,
  pageCount,
  scale,
  docVersion,
  onPageChange,
  testId,
  pageSize,
  children,
}: PdfPagePreviewCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = page ?? pageSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!page) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    void renderPageToCanvas(pdf, pageIndex, canvas, scale);
  }, [pdf, page, pageIndex, scale, docVersion]);

  if (!size) return null;

  return (
    <div className="relative select-none self-start rounded-lg border bg-card p-2 shadow-shell">
      <div
        className="relative overflow-hidden bg-white"
        style={{ width: size.width * scale, height: size.height * scale }}
        data-testid={testId}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {children}
      </div>
      <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <PreviewNavButton
          title="Previous page"
          disabled={pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </PreviewNavButton>
        Page {pageIndex + 1} / {pageCount}
        <PreviewNavButton
          title="Next page"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </PreviewNavButton>
      </div>
    </div>
  );
}

function PreviewNavButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip label={title}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className="h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        {children}
      </Button>
    </Tip>
  );
}
