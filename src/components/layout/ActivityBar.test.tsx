// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Files, History } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

const items = [
  { key: "recent", label: "Recent", icon: History },
  { key: "pages", label: "Pages", icon: Files },
] as const;

describe("ActivityBar", () => {
  it("keeps the footer action at the end of the rail", () => {
    render(
      <ActivityBar
        items={items}
        activeItem="recent"
        panelOpen
        onSelect={() => {}}
        footer={<button type="button">Hide sidebar</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
  });

  it("marks the open activity and switches views", () => {
    const onSelect = vi.fn();
    render(
      <ActivityBar
        items={items}
        activeItem="recent"
        panelOpen
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Sidebar views" }).className,
    ).toContain("border-r");
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(screen.getByRole("button", { name: "Pages" }).getAttribute("aria-pressed"))
      .toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    expect(onSelect).toHaveBeenCalledWith("pages");
  });

  it("keeps the active item visually collapsed when the panel is closed", () => {
    render(
      <ActivityBar
        items={items}
        activeItem="recent"
        panelOpen={false}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(
      screen.getByRole("navigation", { name: "Sidebar views" }).className,
    ).not.toContain("border-r");
  });

  it("does not invoke disabled activities", () => {
    const onSelect = vi.fn();
    render(
      <ActivityBar
        items={[items[0], { ...items[1], disabled: true }]}
        activeItem="recent"
        panelOpen
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pages" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
