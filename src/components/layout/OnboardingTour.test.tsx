// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_TOUR_EVENT,
  ONBOARDING_TOUR_STORAGE_KEY,
  TUTORIAL_CENTER_EVENT,
  OnboardingTour,
} from "./OnboardingTour";

const callbacks = {
  onOpenDocument: vi.fn(),
  onChooseComment: vi.fn(),
  onOpenComments: vi.fn(),
  onFocusSearch: vi.fn(),
  onOpenReplace: vi.fn(),
  onOpenSplit: vi.fn(),
  onChooseEditText: vi.fn(),
  onOpenSignature: vi.fn(),
  onChooseRedact: vi.fn(),
  onRunOcr: vi.fn(),
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
    <div data-tour="comments-list">Comments list</div>
    <div data-tour="document-search">Search</div>
    <button data-tour="replace-toggle">Replace</button>
    <button data-tour="text-tools">Text tools</button>
    <button data-tour="sign-document">Sign</button>
    <button data-tour="cleanup-tools">Cleanup</button>
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
    fireEvent.click(screen.getByRole("button", { name: "Close tutorial" }));
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

  it("opens a topic library and launches the Find & replace tutorial", async () => {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    render(<OnboardingTour hasDocument {...callbacks} />);

    window.dispatchEvent(new CustomEvent(TUTORIAL_CENTER_EVENT));
    expect(await screen.findByText("Learn PickPDF")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Find & replace tutorial" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Comments tutorial" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Edit existing text tutorial" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Sign a PDF tutorial" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start Redact sensitive information tutorial" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Make scans searchable tutorial" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start Find & replace tutorial" }));
    expect(screen.getByText("Your PDF is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus search" }));
    expect(callbacks.onFocusSearch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Open replace" }));
    expect(callbacks.onOpenReplace).toHaveBeenCalledOnce();
  });

  it("guides users from adding a comment to viewing the Comments panel", async () => {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    render(<OnboardingTour hasDocument {...callbacks} />);

    window.dispatchEvent(new CustomEvent(TUTORIAL_CENTER_EVENT));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start Comments tutorial" }),
    );
    await waitFor(() => expect(screen.queryByText("Learn PickPDF")).toBeNull());
    expect(screen.getByText("Your PDF is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Comment" }));
    expect(callbacks.onChooseComment).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(callbacks.onOpenComments).toHaveBeenCalledOnce();
    expect(screen.getByText("Review all comments")).toBeTruthy();
  });

  it("launches the editing and document action tutorials", async () => {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    render(<OnboardingTour hasDocument {...callbacks} />);

    window.dispatchEvent(new CustomEvent(TUTORIAL_CENTER_EVENT));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start Edit existing text tutorial" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Edit text" }));
    expect(callbacks.onChooseEditText).toHaveBeenCalledOnce();

    window.dispatchEvent(new CustomEvent(TUTORIAL_CENTER_EVENT));
    fireEvent.click(
      await screen.findByRole("button", { name: "Start Redact sensitive information tutorial" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose Redact" }));
    expect(callbacks.onChooseRedact).toHaveBeenCalledOnce();
  });
});
