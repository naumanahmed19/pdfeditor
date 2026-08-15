// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MessageSquare } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyStateMessage } from "./empty-state-message";

afterEach(cleanup);

describe("EmptyStateMessage", () => {
  it("renders a centered icon, title, and description", () => {
    render(
      <EmptyStateMessage
        icon={MessageSquare}
        title="No comments yet"
        description="Use the comment tool to add one."
      />,
    );

    const message = screen.getByRole("status");
    expect(message.className).toContain("items-center");
    expect(screen.getByText("No comments yet")).toBeTruthy();
    expect(screen.getByText("Use the comment tool to add one.")).toBeTruthy();
    expect(message.querySelector("svg")).toBeTruthy();
  });
});
