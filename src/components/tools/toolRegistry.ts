import {
  Combine,
  Crop,
  Droplets,
  FileCheck2,
  FileOutput,
  FilePlus2,
  GitCompare,
  Heading,
  LayoutGrid,
  Minimize2,
  Scissors,
  type LucideIcon,
} from "lucide-react";
import { type Screen } from "../../types";

export type ToolCategory = "current" | "general";
export type ToolScreen = Exclude<
  Screen,
  "viewer" | "welcome" | "templates" | "settings"
>;

export interface ToolDefinition {
  screen: ToolScreen;
  title: string;
  commandLabel?: string;
  menuLabel: string;
  description: string;
  icon: LucideIcon;
  category: ToolCategory;
  aliases?: string[];
  menuOrder: number;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    screen: "organize",
    title: "Organize pages",
    menuLabel: "Organize pages",
    description: "Reorder, rotate, delete, duplicate, or insert pages.",
    icon: LayoutGrid,
    category: "current",
    aliases: ["pages"],
    menuOrder: 10,
  },
  {
    screen: "watermark",
    title: "Watermark & numbers",
    menuLabel: "Watermark & numbers",
    description: "Add watermark text or page numbers.",
    icon: Droplets,
    category: "current",
    menuOrder: 20,
  },
  {
    screen: "headerfooter",
    title: "Headers & footers",
    menuLabel: "Headers & footers…",
    description: "Add headers, footers, dates, and Bates numbers.",
    icon: Heading,
    category: "current",
    aliases: ["bates"],
    menuOrder: 30,
  },
  {
    screen: "crop",
    title: "Crop pages",
    menuLabel: "Crop pages…",
    description: "Trim margins or crop a page region.",
    icon: Crop,
    category: "current",
    menuOrder: 40,
  },
  {
    screen: "compress",
    title: "Compress",
    menuLabel: "Compress…",
    description: "Reduce PDF size by recompressing images.",
    icon: Minimize2,
    category: "current",
    menuOrder: 50,
  },
  {
    screen: "export",
    title: "Export",
    menuLabel: "Export (text / HTML / images)…",
    description: "Export text, HTML, images, or DOCX.",
    icon: FileOutput,
    category: "current",
    menuOrder: 60,
  },
  {
    screen: "compare",
    title: "Compare documents",
    commandLabel: "Compare",
    menuLabel: "Compare documents…",
    description: "Compare the open PDF with another document.",
    icon: GitCompare,
    category: "current",
    aliases: ["diff"],
    menuOrder: 70,
  },
  {
    screen: "pdfa",
    title: "PDF/A check",
    menuLabel: "PDF/A check…",
    description: "Preflight the open PDF against PDF/A-2b rules.",
    icon: FileCheck2,
    category: "current",
    aliases: ["preflight", "archive", "validate"],
    menuOrder: 80,
  },
  {
    screen: "merge",
    title: "Merge PDFs",
    menuLabel: "Merge PDFs",
    description: "Combine PDFs and images into one document.",
    icon: Combine,
    category: "general",
    aliases: ["combine"],
    menuOrder: 10,
  },
  {
    screen: "split",
    title: "Split & extract",
    menuLabel: "Split & extract",
    description: "Choose a PDF, select pages visually, or split into single pages.",
    icon: Scissors,
    category: "general",
    menuOrder: 20,
  },
  {
    screen: "createimages",
    title: "Images to PDF",
    menuLabel: "Images to PDF…",
    description: "Build a PDF from PNG or JPEG images, one page each.",
    icon: FilePlus2,
    category: "general",
    aliases: ["create pdf", "png", "jpeg", "photos", "convert"],
    menuOrder: 30,
  },
  {
    screen: "createdoc",
    title: "Word or text to PDF",
    menuLabel: "Word or text to PDF…",
    description: "Convert a .docx or plain-text file into a PDF.",
    icon: FilePlus2,
    category: "general",
    aliases: ["create pdf", "docx", "word", "text", "convert"],
    menuOrder: 40,
  },
];

export const CURRENT_PDF_TOOLS = TOOL_DEFINITIONS
  .filter((tool) => tool.category === "current")
  .sort((a, b) => a.menuOrder - b.menuOrder);

export const GENERAL_TOOLS = TOOL_DEFINITIONS
  .filter((tool) => tool.category === "general")
  .sort((a, b) => a.menuOrder - b.menuOrder);

export const TOOL_BY_SCREEN = Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.screen, tool]),
) as Record<ToolScreen, ToolDefinition>;

export const FILE_SCOPED_TOOL_SCREENS = new Set<Screen>(
  CURRENT_PDF_TOOLS.map((tool) => tool.screen),
);
