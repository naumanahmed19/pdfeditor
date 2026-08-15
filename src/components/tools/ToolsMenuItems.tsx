import { Layers2, ScanText } from "lucide-react";
import {
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from "../ui/menu";
import {
  CURRENT_PDF_TOOLS,
  GENERAL_TOOLS,
  type ToolScreen,
} from "./toolRegistry";

interface ToolsMenuItemsProps {
  hasPdf: boolean;
  ocrBusy: boolean;
  onFlatten: () => void;
  onRunOcr: () => void;
  onSelectScreen: (screen: ToolScreen) => void;
}

/** Shared contents for every PickPDF tools menu entry point. */
export function ToolsMenuItems({
  hasPdf,
  ocrBusy,
  onFlatten,
  onRunOcr,
  onSelectScreen,
}: ToolsMenuItemsProps) {
  return (
    <>
      <MenuGroup aria-label="Current PDF tools">
        <MenuLabel>Current PDF</MenuLabel>
        {CURRENT_PDF_TOOLS.map(({ screen, menuLabel, icon: Icon }) => (
          <MenuItem key={screen} onClick={() => onSelectScreen(screen)}>
            <Icon className="h-4 w-4 text-muted-foreground" />
            {menuLabel}
          </MenuItem>
        ))}
        <MenuItem disabled={!hasPdf || ocrBusy} onClick={onRunOcr}>
          <ScanText className="h-4 w-4 text-muted-foreground" />
          Make searchable (OCR)
        </MenuItem>
        <MenuItem disabled={!hasPdf} onClick={onFlatten}>
          <Layers2 className="h-4 w-4 text-muted-foreground" />
          Flatten document
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup aria-label="General tools">
        <MenuLabel>General tools</MenuLabel>
        {GENERAL_TOOLS.map(({ screen, menuLabel, icon: Icon }) => (
          <MenuItem key={screen} onClick={() => onSelectScreen(screen)}>
            <Icon className="h-4 w-4 text-muted-foreground" />
            {menuLabel}
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );
}
