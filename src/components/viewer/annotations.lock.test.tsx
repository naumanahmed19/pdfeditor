// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLockControl } from "./annotations";

afterEach(() => cleanup());

describe("annotation canvas lock control", () => {
  it("locks an object without starting a canvas edit gesture", () => {
    const onToggle = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <CanvasLockControl
          locked={false}
          visible={false}
          onToggle={onToggle}
        />
      </div>,
    );

    const lock = screen.getByRole("button", { name: "Lock object" });
    expect(lock.className).toContain("group-hover/annotation:opacity-100");

    fireEvent.pointerDown(lock);
    fireEvent.click(lock);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows an unlock action for a locked object", () => {
    const onToggle = vi.fn();
    render(
      <CanvasLockControl locked visible={false} onToggle={onToggle} />,
    );

    const unlock = screen.getByRole("button", { name: "Unlock object" });
    expect(unlock.getAttribute("aria-pressed")).toBe("true");
    expect(unlock.className).toContain("group-hover/annotation:opacity-100");

    fireEvent.click(unlock);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
