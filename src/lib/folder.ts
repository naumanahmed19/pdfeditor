import type { FolderNode } from "../types";

const isPdf = (name: string) => name.toLowerCase().endsWith(".pdf");

function sortNodes(nodes: FolderNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

/** Open a folder and build a tree of its PDFs (nested folders included). */
export async function pickFolder(): Promise<FolderNode | null> {
  const picker = (window as any).showDirectoryPicker;
  if (picker) {
    try {
      const dir = await picker.call(window, { mode: "readwrite" });
      return await readDirHandle(dir, dir.name);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return null;
      // Permission or other error — fall through to the input fallback.
    }
  }
  return pickViaInput();
}

async function readDirHandle(handle: any, path: string): Promise<FolderNode> {
  const children: FolderNode[] = [];
  for await (const entry of handle.values()) {
    const childPath = `${path}/${entry.name}`;
    if (entry.kind === "directory") {
      const sub = await readDirHandle(entry, childPath);
      // Keep directories only if they contain (nested) PDFs.
      if (sub.children && sub.children.length) children.push(sub);
    } else if (isPdf(entry.name)) {
      children.push({ name: entry.name, path: childPath, kind: "file", handle: entry });
    }
  }
  sortNodes(children);
  return { name: handle.name, path, kind: "dir", children };
}

/** Fallback: <input webkitdirectory> gives a flat list with relative paths. */
function pickViaInput(): Promise<FolderNode | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as any).webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []).filter((f) => isPdf(f.name));
      resolve(files.length ? buildTreeFromFiles(files) : null);
    };
    input.click();
  });
}

function buildTreeFromFiles(files: File[]): FolderNode {
  const rootName = (files[0] as any).webkitRelativePath?.split("/")[0] || "Folder";
  const root: FolderNode = { name: rootName, path: rootName, kind: "dir", children: [] };

  for (const file of files) {
    const rel = (file as any).webkitRelativePath as string | undefined;
    const parts = (rel ?? file.name).split("/");
    // parts[0] is the root folder name; walk/create intermediate dirs.
    let node = root;
    for (let i = 1; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const childPath = `${node.path}/${dirName}`;
      let dir = node.children!.find((c) => c.kind === "dir" && c.name === dirName);
      if (!dir) {
        dir = { name: dirName, path: childPath, kind: "dir", children: [] };
        node.children!.push(dir);
      }
      node = dir;
    }
    const fileName = parts[parts.length - 1];
    node.children!.push({
      name: fileName,
      path: `${node.path}/${fileName}`,
      kind: "file",
      file,
    });
  }

  const sortRec = (n: FolderNode) => {
    if (n.children) {
      sortNodes(n.children);
      n.children.forEach(sortRec);
    }
  };
  sortRec(root);
  return root;
}

/** Read a file node's bytes (and handle, when available for save-in-place). */
export async function readNode(
  node: FolderNode,
): Promise<{ file: File; name: string; handle?: unknown }> {
  if (node.handle) {
    const file = await (node.handle as any).getFile();
    return {
      file,
      name: node.name,
      handle: node.handle,
    };
  }
  if (node.file) {
    return {
      file: node.file,
      name: node.name,
    };
  }
  throw new Error("Folder entry has no file");
}
