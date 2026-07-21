import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export async function saveMobileFile(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await writeFile(path, bytes);
  return path;
}
