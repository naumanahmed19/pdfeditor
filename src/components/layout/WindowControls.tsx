import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Custom min/maximize/close buttons for the frameless (decorations: false)
 * Tauri window. Only rendered inside the desktop shell — see isTauri.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const win = () => getCurrentWindow();

  return (
    <div className="flex h-full items-center">
      <WinButton title="Minimize" onClick={() => void win().minimize()}>
        <Minus className="h-4 w-4" strokeWidth={2} />
      </WinButton>
      <WinButton
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void win().toggleMaximize()}
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5 -scale-x-100" strokeWidth={2} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2} />
        )}
      </WinButton>
      <WinButton title="Close" danger onClick={() => void win().close()}>
        <X className="h-4 w-4" strokeWidth={2} />
      </WinButton>
    </div>
  );
}

function WinButton({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={
        "inline-flex h-full w-11 items-center justify-center text-muted-foreground transition-colors " +
        (danger
          ? "hover:bg-destructive hover:text-destructive-foreground"
          : "hover:bg-accent hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
