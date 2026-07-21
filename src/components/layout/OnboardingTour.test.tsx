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

beforeEach(() => {
  localStorage.clear();
  Object.values(callbacks).forEach((callback) => callback.mockClear());
});

afterEach(() => cleanup());

describe("OnboardingTour", () => {
  it("opens for a first-time user and remembers when it is skipped", async () => {
    const view = render(<OnboardingTour hasDocument={false} {...callbacks} />);

    expect(await screen.findByText("The basics, one step at a time")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByText("The basics, one step at a time")).toBeNull());
    expect(localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)).toBe("1");

    view.unmount();
    render(<OnboardingTour hasDocument={false} {...callbacks} />);
    await waitFor(() => expect(screen.queryByText("The basics, one step at a time")).toBeNull());
  });

  it("can be replayed and walks through the core actions", async () => {
    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
    const view = render(<OnboardingTour hasDocument={false} {...callbacks} />);

    window.dispatchEvent(new CustomEvent(ONBOARDING_TOUR_EVENT));
    expect(await screen.findByText("The basics, one step at a time")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a PDF" }));
    expect(callbacks.onOpenDocument).toHaveBeenCalledOnce();
    view.rerender(<OnboardingTour hasDocument {...callbacks} />);
    expect(screen.getByText("PDF ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose the Comment tool" }));
    expect(callbacks.onChooseComment).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Split & extract" }));
    expect(callbacks.onOpenSplit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Search all tools" }));
    expect(callbacks.onOpenCommandPalette).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText("Split a file — and find anything else")).toBeNull());
  });
});
