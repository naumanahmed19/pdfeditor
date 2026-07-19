// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AiReportDraft } from "../../lib/aiReport";
import { AiReportDialog } from "./AiReportDialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

afterEach(() => cleanup());

const requiredProps = {
  open: true,
  response: "The response being reported",
  provider: "Built-in",
  model: "Gemma 4 (built-in)",
};

describe("AiReportDialog", () => {
  it("closes without creating a report when cancelled", () => {
    const onOpenChange = vi.fn();
    const sendReport = vi.fn(async (_draft: AiReportDraft) => {});

    render(
      <AiReportDialog
        {...requiredProps}
        onOpenChange={onOpenChange}
        sendReport={sendReport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sendReport).not.toHaveBeenCalled();
  });

  it("creates the email draft and closes after submission", async () => {
    const onOpenChange = vi.fn();
    const sendReport = vi.fn(async (_draft: AiReportDraft) => {});

    render(
      <AiReportDialog
        {...requiredProps}
        onOpenChange={onOpenChange}
        sendReport={sendReport}
      />,
    );

    fireEvent.change(screen.getByLabelText("Additional report details"), {
      target: { value: "The answer encouraged unsafe behavior." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to email" }),
    );

    await waitFor(() => expect(sendReport).toHaveBeenCalledTimes(1));
    const [draft] = sendReport.mock.calls[0]!;
    expect(draft.body).toContain(requiredProps.response);
    expect(draft.body).toContain(requiredProps.provider);
    expect(draft.body).toContain(requiredProps.model);
    expect(draft.body).toContain("The answer encouraged unsafe behavior.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("copies the report and shows an error when email cannot be opened", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const sendReport = vi.fn(async (_draft: AiReportDraft) => {
      throw new Error("No email application");
    });

    render(
      <AiReportDialog
        {...requiredProps}
        onOpenChange={vi.fn()}
        sendReport={sendReport}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to email" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain(requiredProps.response);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("The report was copied"),
    );
  });
});
