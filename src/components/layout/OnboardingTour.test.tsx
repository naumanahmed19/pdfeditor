// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_TOUR_EVENT,
  ONBOARDING_TOUR_STORAGE_KEY,
  OnboardingTour,
} from "./OnboardingTour";

const callbacks = {
  onOpenDocument: vi.fn(),
  onChooseComment: vi.fn(),
  onOpenSplit: vi.fn(),
  onOpenCommandPalette: vi.fn(),
};

let targets: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  Object.values(callbacks).forEach((callback) => callback.mockClear());
  targets = document.createElement("div");
  targets.innerHTML = `
    <button data-tour="open-pdf">Open</button>
    <div data-tour="document-header">Document</div>
    <button data-tour="comment-tools">Comment</button>
    <button data-tour="tools-menu">Tools</button>
    <button data-tour="command-palette">Commands</button>
  `;
  document.body.appendChild(targets);
});

afterEach(() => {
  cleanup();
  targets.remove();
});

describe("OnboardingTour", () => {
  it("spotlights the first control and remembers when it is closed", async () => {
    const view = render(<OnboardingTour hasDocument={false} {...callbacks} />);

    expect(await screen.findByText("Open your first PDF")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close tour" }));
    await waitFor(() => expect(screen.queryByText("Open your first PDF")).toBeNull());
    expect(localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)).toBe("1");

    view.unmount();
    render(<OnboardingTour hasDocument={false} {...callbacks} />);
    await waitFor(() => expect(screen.queryByText("Open your first PDF")).toBeNull());
  });

  it("can be replayed and walks through the highlighted controls", async () => {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    const view = render(<OnboardingTour hasDocument={false} {...callbacks} />);

    window.dispatchEvent(new CustomEvent(ONBOARDING_TOUR_EVENT));
    expect(await screen.findByText("Open your first PDF")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    expect(callbacks.onOpenDocument).toHaveBeenCalledOnce();

    view.rerender(<OnboardingTour hasDocument {...callbacks} />);
    expect(screen.getByText("Your PDF is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Add a comment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose Comment" }));
    expect(callbacks.onChooseComment).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Split or extract pages")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Split & extract" }));
    expect(callbacks.onOpenSplit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Find every tool fast")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(callbacks.onOpenCommandPalette).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText("Find every tool fast")).toBeNull());
  });

  it("uses the visible command palette instead of the native Tools menu on Mac", async () => {
    render(<OnboardingTour hasDocument nativeMacMenu {...callbacks} />);

    expect(await screen.findByText("Your PDF is ready")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Split or find any tool")).toBeTruthy();
    expect(screen.getByText("3/3")).toBeTruthy();
    expect(screen.getByText(/Tools → Split & Extract/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open command palette" }));

    expect(callbacks.onOpenCommandPalette).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSplit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Split or find any tool")).toBeNull());
  });
});
