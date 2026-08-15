// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuContent, MenuTrigger } from "../ui/menu";
import { ToolsMenuItems } from "./ToolsMenuItems";

afterEach(cleanup);

describe("ToolsMenuItems", () => {
  it("shares grouped tool actions across menu entry points", async () => {
    const onSelectScreen = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Tools</MenuTrigger>
        <MenuContent>
          <ToolsMenuItems
            hasPdf
            ocrBusy={false}
            onFlatten={() => {}}
            onRunOcr={() => {}}
            onSelectScreen={onSelectScreen}
          />
        </MenuContent>
      </Menu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const merge = await screen.findByRole("menuitem", { name: "Merge PDFs" });
    expect(screen.getByText("Current PDF")).toBeTruthy();
    expect(screen.getByText("General tools")).toBeTruthy();

    fireEvent.click(merge);
    expect(onSelectScreen).toHaveBeenCalledWith("merge");
  });
});
