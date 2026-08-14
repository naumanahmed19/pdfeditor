import { useState, type DragEvent, type DragEventHandler } from "react";

export interface ToolFileDropHandlers {
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
}

export type DroppedHandlePromises = Array<Promise<unknown>>;

const hasFiles = (event: DragEvent<HTMLDivElement>) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Makes an entire tool screen own OS file drops. Stopping propagation keeps
 * the window-level DropZone from also opening files the tool has consumed.
 */
export function useToolFileDrop(
  onFiles: (files: File[], handles: DroppedHandlePromises) => void | Promise<void>,
): { dragOver: boolean; dropHandlers: ToolFileDropHandlers } {
  const [dragOver, setDragOver] = useState(false);

  return {
    dragOver,
    dropHandlers: {
      onDragOver: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      },
      onDragLeave: (event) => {
        if (!hasFiles(event)) return;
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setDragOver(false);
      },
      onDrop: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);

        const files = Array.from(event.dataTransfer.files ?? []);
        // Chromium clears DataTransfer.items as soon as the handler yields.
        const handles = Array.from(event.dataTransfer.items ?? []).map((item) =>
          Promise.resolve((item as any).getAsFileSystemHandle?.() ?? null),
        );
        void onFiles(files, handles);
      },
    },
  };
}

export const isPdfFile = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export const isPngFile = (file: File) =>
  file.type === "image/png" || /\.png$/i.test(file.name);

export const isJpegFile = (file: File) =>
  file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
