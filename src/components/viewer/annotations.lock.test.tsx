// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLockControl } from "./annotations";

afterEach(() => cleanup());

describe("annotation canvas lock control", () => {
  it("locks an object without starting a canvas edit gesture", () => {
    const onLock = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <CanvasLockControl visible={false} onLock={onLock} />
      </div>,
    );

    const lock = screen.getByRole("button", { name: "Lock object" });
    expect(lock.className).toContain("group-hover/annotation:opacity-100");

    fireEvent.pointerDown(lock);
    fireEvent.click(lock);

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});
