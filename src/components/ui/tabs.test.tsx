// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

afterEach(cleanup);

describe("Tabs", () => {
  it("switches the active panel", () => {
    render(
      <Tabs defaultValue="pages">
        <TabsList aria-label="Document navigation">
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="outline">Outline</TabsTrigger>
        </TabsList>
        <TabsContent value="pages">Page thumbnails</TabsContent>
        <TabsContent value="outline">Document outline</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "Pages" }).getAttribute("aria-selected"))
      .toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Outline" }));
    expect(screen.getByRole("tab", { name: "Outline" }).getAttribute("aria-selected"))
      .toBe("true");
    expect(screen.getByText("Document outline")).toBeTruthy();
  });
});
