import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  CaseSensitive,
  Check,
  Circle,
  Combine,
  Crop,
  Download,
  Droplets,
  Eraser,
  FileOutput,
  FilePlus2,
  FolderOpen,
  FormInput,
  GitCompare,
  Heading,
  Highlighter,
  Image as ImageIcon,
  Info,
  Layers2,
  Link2,
  Lock,
  LockOpen,
  MessageSquare,
  MessageSquareQuote,
  Minimize2,
  Minus,
  MousePointer2,
  MousePointerClick,
  Move,
  MoveUpRight,
  PanelLeft,
  PaintBucket,
  Paperclip,
  Pencil,
  Printer,
  Save,
  ScanText,
  Scissors,
  Search,
  Settings,
  Signature,
  Square,
  SquareSlash,
  Stamp,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { shallowEqual, useAppSelector } from "../../store";
import { makeStamp, STAMPS } from "../../lib/stamps";
import { cn } from "../../lib/utils";
import type { Screen, ToolKind } from "../../types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";

type CommandGroupId =
  | "global"
  | "document"
  | "sidebar"
  | "editor"
  | "insert";

interface PaletteCommand {
  id: string;
  group: CommandGroupId;
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;
  aliases?: string[];
  disabledReason?: string;
  action: () => void | Promise<void>;
}

const GROUPS: Array<{ id: CommandGroupId; heading: string }> = [
  { id: "global", heading: "Global" },
  { id: "document", heading: "Document Tools" },
  { id: "sidebar", heading: "Sidebar & Panels" },
  { id: "editor", heading: "Editor Tools" },
  { id: "insert", heading: "Insert & Sign" },
];

const EDITOR_TOOLS: Array<{
  key: ToolKind;
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;
  aliases?: string[];
}> = [
  {
    key: "read",
    label: "Read",
    description: "Select text, copy, and follow links.",
    icon: MousePointer2,
    shortcut: "V",
    aliases: ["view", "browse"],
  },
  {
    key: "select",
    label: "Select",
    description: "Move, resize, or delete annotations.",
    icon: Move,
    shortcut: "M",
    aliases: ["move"],
  },
  {
    key: "text",
    label: "Add text",
    description: "Place a new text box on the page.",
    icon: Type,
    shortcut: "T",
  },
  {
    key: "edittext",
    label: "Edit text",
    description: "Retype existing PDF text.",
    icon: TextCursorInput,
    shortcut: "E",
  },
  {
    key: "editobject",
    label: "Move objects",
    description: "Move, resize, recolor, or delete existing page objects.",
    icon: MousePointerClick,
    shortcut: "G",
  },
  {
    key: "highlight",
    label: "Highlight",
    description: "Highlight selected text or an area.",
    icon: Highlighter,
    shortcut: "H",
  },
  {
    key: "underline",
    label: "Underline text",
    description: "Underline existing PDF text.",
    icon: Underline,
    shortcut: "U",
  },
  {
    key: "strikeout",
    label: "Strike through text",
    description: "Strike out existing PDF text.",
    icon: Strikethrough,
    shortcut: "S",
    aliases: ["strikethrough"],
  },
  {
    key: "squiggly",
    label: "Squiggly underline",
    description: "Add a squiggly underline to text.",
    icon: Waves,
  },
  {
    key: "note",
    label: "Comment",
    description: "Add a sticky note comment.",
    icon: MessageSquare,
    shortcut: "C",
    aliases: ["note"],
  },
  {
    key: "ink",
    label: "Draw",
    description: "Draw freehand ink strokes.",
    icon: Pencil,
    shortcut: "D",
    aliases: ["freehand", "pen"],
  },
  {
    key: "mark",
    label: "Check / cross",
    description: "Stamp a checkmark or cross.",
    icon: Check,
    shortcut: "Y",
    aliases: ["tick"],
  },
  {
    key: "link",
    label: "Link",
    description: "Draw a clickable link area.",
    icon: Link2,
    shortcut: "N",
  },
  {
    key: "rect",
    label: "Rectangle",
    description: "Draw a rectangle.",
    icon: Square,
    shortcut: "R",
  },
  {
    key: "ellipse",
    label: "Ellipse",
    description: "Draw an ellipse.",
    icon: Circle,
    shortcut: "O",
  },
  {
    key: "line",
    label: "Line",
    description: "Draw a straight line.",
    icon: Minus,
    shortcut: "L",
  },
  {
    key: "arrow",
    label: "Arrow",
    description: "Draw an arrow.",
    icon: MoveUpRight,
    shortcut: "A",
  },
  {
    key: "callout",
    label: "Callout",
    description: "Draw a callout note with a pointer.",
    icon: MessageSquareQuote,
    shortcut: "K",
  },
  {
    key: "whiteout",
    label: "Whiteout",
    description: "Cover page content with a white box.",
    icon: PaintBucket,
    shortcut: "W",
  },
  {
    key: "eraser",
    label: "Eraser",
    description: "Delete annotations by clicking or dragging over them.",
    icon: Eraser,
  },
  {
    key: "redact",
    label: "Redact",
    description: "Draw boxes that permanently remove content when applied.",
    icon: SquareSlash,
    shortcut: "X",
  },
];

const DOCUMENT_SCREENS: Array<{
  screen: Screen;
  label: string;
  description: string;
  icon: LucideIcon;
  needsPdf?: boolean;
  aliases?: string[];
}> = [
  {
    screen: "organize",
    label: "Organize pages",
    description: "Reorder, rotate, delete, duplicate, or insert pages.",
    icon: Layers2,
    needsPdf: true,
    aliases: ["pages"],
  },
  {
    screen: "merge",
    label: "Merge PDFs",
    description: "Combine PDFs and images into one document.",
    icon: Combine,
    aliases: ["combine"],
  },
  {
    screen: "split",
    label: "Split & extract",
    description: "Extract page ranges or split into single pages.",
    icon: Scissors,
    needsPdf: true,
  },
  {
    screen: "watermark",
    label: "Watermark & numbers",
    description: "Add watermark text or page numbers.",
    icon: Droplets,
    needsPdf: true,
  },
  {
    screen: "headerfooter",
    label: "Headers & footers",
    description: "Add headers, footers, dates, and Bates numbers.",
    icon: Heading,
    needsPdf: true,
    aliases: ["bates"],
  },
  {
    screen: "crop",
    label: "Crop pages",
    description: "Trim margins or crop a page region.",
    icon: Crop,
    needsPdf: true,
  },
  {
    screen: "compress",
    label: "Compress",
    description: "Reduce PDF size by recompressing images.",
    icon: Minimize2,
    needsPdf: true,
  },
  {
    screen: "export",
    label: "Export",
    description: "Export text, HTML, images, or DOCX.",
    icon: FileOutput,
    needsPdf: true,
  },
  {
    screen: "compare",
    label: "Compare",
    description: "Compare the open PDF with another document.",
    icon: GitCompare,
    needsPdf: true,
    aliases: ["diff"],
  },
];

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function acronym(value: string): string {
  return normalizeSearch(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

function commandFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const query = normalizeSearch(search);
  if (!query) return 1;

  const fields = [value, ...(keywords ?? [])].map(normalizeSearch).filter(Boolean);
  const queryParts = query.split(/\s+/).filter(Boolean);
  if (!fields.length || !queryParts.length) return 0;

  let score = 0;
  for (const part of queryParts) {
    let partScore = 0;
    for (const field of fields) {
      const words = field.split(/\s+/).filter(Boolean);
      if (field === part) partScore = Math.max(partScore, 10);
      else if (field.startsWith(part)) partScore = Math.max(partScore, 8);
      else if (words.some((word) => word === part)) partScore = Math.max(partScore, 7);
      else if (words.some((word) => word.startsWith(part))) partScore = Math.max(partScore, 6);
      else if (acronym(field).startsWith(part)) partScore = Math.max(partScore, 5);
      else if (field.includes(part)) partScore = Math.max(partScore, 2);
    }
    if (!partScore) return 0;
    score += partScore;
  }

  return score / queryParts.length;
}

function CommandRow({
  command,
  onRun,
}: {
  command: PaletteCommand;
  onRun: (command: PaletteCommand) => void;
}) {
  const Icon = command.icon;
  const disabled = !!command.disabledReason;

  return (
    <CommandItem
      value={command.label}
      keywords={command.aliases}
      disabled={disabled}
      onSelect={() => onRun(command)}
      className="group items-center gap-3"
      title={command.disabledReason}
    >
      <Icon
        className={cn(
          "h-4 w-4 text-muted-foreground transition-colors group-data-[selected=true]:text-foreground",
          disabled && "opacity-60",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {command.label}
      </span>
      {command.shortcut && (
        <CommandShortcut>{command.shortcut}</CommandShortcut>
      )}
    </CommandItem>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const app = useAppSelector(
    (s) => ({
      activeProtected: s.activeProtected,
      aiOpen: s.aiOpen,
      applyBytesOp: s.applyBytesOp,
      docPermissions: s.docPermissions,
      downloadCurrent: s.downloadCurrent,
      folderBusy: s.folderBusy,
      formBuilder: s.formBuilder,
      isMobile: s.isMobile,
      ocrBusy: s.ocrBusy,
      openFolder: s.openFolder,
      pdf: s.pdf,
      printCurrent: s.printCurrent,
      requestOpen: s.requestOpen,
      runOcrText: s.runOcrText,
      saveCurrent: s.saveCurrent,
      screen: s.screen,
      setAiOpen: s.setAiOpen,
      setFormBuilder: s.setFormBuilder,
      setPendingStamp: s.setPendingStamp,
      setScreen: s.setScreen,
      setSecurityModalOpen: s.setSecurityModalOpen,
      setSelected: s.setSelected,
      setSidebarOpen: s.setSidebarOpen,
      setSignatureModalOpen: s.setSignatureModalOpen,
      setTool: s.setTool,
      sidebarOpen: s.sidebarOpen,
    }),
    shallowEqual,
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("pdfwb:open-command-palette", onOpen);
    return () => window.removeEventListener("pdfwb:open-command-palette", onOpen);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasPdfReason = app.pdf ? undefined : "Open a PDF first";
  const permissionReason = "Unlock document permissions";

  const toolReason = (tool: ToolKind): string | undefined => {
    if (!app.pdf) return hasPdfReason;
    const p = app.docPermissions;
    if (!p.restricted || tool === "read") return undefined;
    if (tool === "edittext" || tool === "editobject" || tool === "redact") {
      return p.modify ? undefined : permissionReason;
    }
    if (tool.startsWith("form")) {
      return p.fillForms || p.modify ? undefined : permissionReason;
    }
    return p.annotate || p.modify ? undefined : permissionReason;
  };

  const annotationReason = (): string | undefined => {
    if (!app.pdf) return hasPdfReason;
    const p = app.docPermissions;
    return !p.restricted || p.annotate || p.modify ? undefined : permissionReason;
  };

  const formReason = (): string | undefined => {
    if (!app.pdf) return hasPdfReason;
    const p = app.docPermissions;
    return !p.restricted || p.fillForms || p.modify ? undefined : permissionReason;
  };

  const modifyReason = (): string | undefined => {
    if (!app.pdf) return hasPdfReason;
    const p = app.docPermissions;
    return !p.restricted || p.modify ? undefined : permissionReason;
  };

  const goToScreen = (screen: Screen) => {
    app.setScreen(screen);
    if (app.isMobile) {
      app.setSidebarOpen(false);
      app.setAiOpen(false);
    }
  };

  const activateTool = (tool: ToolKind) => {
    app.setScreen("viewer");
    app.setPendingStamp(null);
    app.setSelected(null);
    app.setTool(tool);
    if (app.isMobile) {
      app.setSidebarOpen(false);
      app.setAiOpen(false);
    }
  };

  const openSidebarPanel = (panel: "pages" | "outline" | "comments" | "attachments" | "form") => {
    app.setScreen("viewer");
    app.setSidebarOpen(true);
    if (app.isMobile) app.setAiOpen(false);
    window.dispatchEvent(
      new CustomEvent("pdfwb:open-sidebar-panel", { detail: { panel } }),
    );
  };

  const pickImage = () => {
    requestAnimationFrame(() => imageRef.current?.click());
  };

  const commands = useMemo<PaletteCommand[]>(() => {
    const globalCommands: PaletteCommand[] = [
      {
        id: "open-pdf",
        group: "global",
        label: "Open PDF",
        description: "Choose one or more PDFs to open.",
        icon: FolderOpen,
        shortcut: "Ctrl O",
        aliases: ["file", "import"],
        action: app.requestOpen,
      },
      {
        id: "new-template",
        group: "global",
        label: "New from template",
        description: "Create a blank PDF or start from a template.",
        icon: FilePlus2,
        aliases: ["blank", "create"],
        action: () => goToScreen("templates"),
      },
      {
        id: "open-folder",
        group: "global",
        label: "Open folder of PDFs",
        description: "Browse a local folder from the sidebar.",
        icon: FolderOpen,
        disabledReason: app.folderBusy ? "Opening folder..." : undefined,
        aliases: ["sidebar folder"],
        action: app.openFolder,
      },
      {
        id: "save",
        group: "global",
        label: "Save",
        description: "Save the active document.",
        icon: Save,
        shortcut: "Ctrl S",
        disabledReason: hasPdfReason,
        action: app.saveCurrent,
      },
      {
        id: "download-copy",
        group: "global",
        label: "Download a copy",
        description: "Export the active PDF as a downloaded file.",
        icon: Download,
        disabledReason: hasPdfReason,
        aliases: ["export copy"],
        action: app.downloadCurrent,
      },
      {
        id: "print",
        group: "global",
        label: "Print",
        description: "Open print options for the active PDF.",
        icon: Printer,
        shortcut: "Ctrl P",
        disabledReason:
          hasPdfReason ??
          (app.docPermissions.restricted && !app.docPermissions.print
            ? "Printing is not allowed"
            : undefined),
        action: app.printCurrent,
      },
      {
        id: "document-search",
        group: "global",
        label: "Search document",
        description: "Focus the document search box.",
        icon: Search,
        shortcut: "Ctrl F",
        disabledReason: hasPdfReason,
        aliases: ["find"],
        action: () => {
          app.setScreen("viewer");
          window.dispatchEvent(new CustomEvent("pdfwb:focus-document-search"));
        },
      },
      {
        id: "find-replace",
        group: "global",
        label: "Find and replace",
        description: "Open replace controls for document search.",
        icon: CaseSensitive,
        shortcut: "Ctrl H",
        disabledReason: hasPdfReason,
        aliases: ["replace"],
        action: () => {
          app.setScreen("viewer");
          window.dispatchEvent(new CustomEvent("pdfwb:open-replace"));
        },
      },
      {
        id: "document-properties",
        group: "global",
        label: "Document properties",
        description: "View PDF metadata and page information.",
        icon: Info,
        disabledReason: hasPdfReason,
        aliases: ["metadata"],
        action: () => window.dispatchEvent(new CustomEvent("pdfwb:open-properties")),
      },
      {
        id: "document-security",
        group: "global",
        label: app.activeProtected ? "Document security" : "Protect document",
        description: "Review permissions or protect this PDF.",
        icon: app.activeProtected ? LockOpen : Lock,
        disabledReason: hasPdfReason,
        aliases: ["password", "permissions", "lock"],
        action: () => app.setSecurityModalOpen(true),
      },
      {
        id: "toggle-ai",
        group: "global",
        label: app.aiOpen ? "Hide AI assistant" : "Show AI assistant",
        description: "Toggle the AI assistant panel.",
        icon: Bot,
        aliases: ["assistant", "chat"],
        action: () => {
          const next = !app.aiOpen;
          app.setAiOpen(next);
          if (next && app.isMobile) app.setSidebarOpen(false);
        },
      },
      {
        id: "settings",
        group: "global",
        label: "Settings",
        description: "Open app settings.",
        icon: Settings,
        action: () => goToScreen("settings"),
      },
      {
        id: "about",
        group: "global",
        label: "About PickPDF",
        description: "View app information.",
        icon: Info,
        aliases: ["version"],
        action: () => window.dispatchEvent(new CustomEvent("pdfwb:open-about")),
      },
    ];

    const documentCommands: PaletteCommand[] = [
      ...DOCUMENT_SCREENS.map((tool) => ({
        id: `screen-${tool.screen}`,
        group: "document" as const,
        label: tool.label,
        description: tool.description,
        icon: tool.icon,
        aliases: tool.aliases,
        disabledReason: tool.needsPdf ? hasPdfReason : undefined,
        action: () => goToScreen(tool.screen),
      })),
      {
        id: "ocr",
        group: "document",
        label: "Make searchable (OCR)",
        description: "Add a searchable text layer to scanned pages.",
        icon: ScanText,
        disabledReason: hasPdfReason ?? (app.ocrBusy ? "OCR is already running" : undefined),
        aliases: ["scan", "searchable"],
        action: app.runOcrText,
      },
      {
        id: "flatten",
        group: "document",
        label: "Flatten document",
        description: "Bake annotations and form fields into page content.",
        icon: Layers2,
        disabledReason: modifyReason(),
        aliases: ["bake"],
        action: () => {
          if (
            !window.confirm(
              "Flatten the document?\n\nAll annotations and form fields are baked permanently into the page content and stop being editable or fillable. This cannot be undone after saving.",
            )
          ) {
            return;
          }
          return app.applyBytesOp(async (bytes) => {
            const { flattenPdf } = await import("../../lib/pdfium");
            return flattenPdf(bytes);
          }, "Document flattened");
        },
      },
    ];

    const sidebarCommands: PaletteCommand[] = [
      {
        id: "toggle-sidebar",
        group: "sidebar",
        label: app.sidebarOpen ? "Hide sidebar" : "Show sidebar",
        description: "Toggle the left sidebar.",
        icon: PanelLeft,
        aliases: ["panel"],
        action: () => {
          const next = !app.sidebarOpen;
          app.setSidebarOpen(next);
          if (next && app.isMobile) app.setAiOpen(false);
        },
      },
      {
        id: "pages-panel",
        group: "sidebar",
        label: "Pages panel",
        description: "Show page thumbnails.",
        icon: Layers2,
        disabledReason: hasPdfReason,
        aliases: ["thumbnails"],
        action: () => openSidebarPanel("pages"),
      },
      {
        id: "outline-panel",
        group: "sidebar",
        label: "Outline panel",
        description: "Show or edit PDF outline entries.",
        icon: BookOpen,
        disabledReason: hasPdfReason,
        aliases: ["bookmarks"],
        action: () => openSidebarPanel("outline"),
      },
      {
        id: "comments-panel",
        group: "sidebar",
        label: "Comments panel",
        description: "Browse sticky note comments.",
        icon: MessageSquare,
        disabledReason: hasPdfReason,
        aliases: ["notes"],
        action: () => openSidebarPanel("comments"),
      },
      {
        id: "attachments-panel",
        group: "sidebar",
        label: "Attachments panel",
        description: "View embedded files in the PDF.",
        icon: Paperclip,
        disabledReason: hasPdfReason,
        aliases: ["files"],
        action: () => openSidebarPanel("attachments"),
      },
      {
        id: "form-builder-panel",
        group: "sidebar",
        label: "Form builder panel",
        description: "Open the fillable form field palette.",
        icon: FormInput,
        disabledReason: formReason(),
        aliases: ["forms", "fields"],
        action: () => openSidebarPanel("form"),
      },
    ];

    const editorCommands: PaletteCommand[] = EDITOR_TOOLS.map((tool) => ({
      id: `tool-${tool.key}`,
      group: "editor",
      label: tool.label,
      description: tool.description,
      icon: tool.icon,
      shortcut: tool.shortcut,
      aliases: tool.aliases,
      disabledReason: toolReason(tool.key),
      action: () => activateTool(tool.key),
    }));

    const insertCommands: PaletteCommand[] = [
      {
        id: "insert-image",
        group: "insert",
        label: "Insert image",
        description: "Choose a PNG or JPEG and place it on the page.",
        icon: ImageIcon,
        disabledReason: annotationReason(),
        aliases: ["photo", "picture"],
        action: pickImage,
      },
      {
        id: "insert-form-builder",
        group: "insert",
        label: app.formBuilder ? "Close form builder" : "Form builder",
        description: "Design fillable text, checkbox, dropdown, date, and signature fields.",
        icon: FormInput,
        disabledReason: formReason(),
        aliases: ["forms", "fields"],
        action: () => {
          app.setScreen("viewer");
          app.setFormBuilder(!app.formBuilder);
        },
      },
      ...STAMPS.map((stamp) => ({
        id: `stamp-${stamp.label.toLowerCase().replace(/\s+/g, "-")}`,
        group: "insert" as const,
        label: `${stamp.label} stamp`,
        description: stamp.withDate
          ? "Place this stamp with today's date."
          : "Place this stamp on the page.",
        icon: Stamp,
        disabledReason: annotationReason(),
        aliases: ["rubber stamp", stamp.label],
        action: () => {
          const { dataUrl, aspect } = makeStamp(stamp);
          app.setScreen("viewer");
          app.setSelected(null);
          app.setPendingStamp({ dataUrl, aspect });
        },
      })),
      {
        id: "signature",
        group: "insert",
        label: "Signature",
        description: "Draw, type, upload, or reuse a saved signature.",
        icon: Signature,
        disabledReason: annotationReason(),
        aliases: ["sign"],
        action: () => {
          app.setScreen("viewer");
          app.setSignatureModalOpen(true);
        },
      },
    ];

    return [
      ...globalCommands,
      ...documentCommands,
      ...sidebarCommands,
      ...editorCommands,
      ...insertCommands,
    ];
  }, [
    app,
    hasPdfReason,
  ]);

  const runCommand = (command: PaletteCommand) => {
    if (command.disabledReason) return;
    setOpen(false);
    Promise.resolve(command.action()).catch((err) => {
      toast.error(
        `Command failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    });
  };

  const onImagePicked = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const image = new Image();
      image.onload = () => {
        app.setScreen("viewer");
        app.setSelected(null);
        app.setPendingStamp({
          dataUrl,
          aspect: image.height / image.width || 1,
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} filter={commandFilter}>
        <CommandInput placeholder="Search tools, panels, and actions..." />
        <CommandList className="max-h-[min(70vh,34rem)]">
          <CommandEmpty>No matching command.</CommandEmpty>
          {GROUPS.map((group, index) => {
            const items = commands.filter((command) => command.group === group.id);
            if (!items.length) return null;
            return (
              <div key={group.id}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group.heading}>
                  {items.map((command) => (
                    <CommandRow
                      key={command.id}
                      command={command}
                      onRun={runCommand}
                    />
                  ))}
                </CommandGroup>
              </div>
            );
          })}
        </CommandList>
        <div className="flex h-8 items-center justify-center gap-2 border-t px-3 text-[11px] text-muted-foreground">
          <span>Toolbar</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span>Sidebar</span>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
          <span>Tools menu</span>
        </div>
      </CommandDialog>
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          onImagePicked(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );
}
