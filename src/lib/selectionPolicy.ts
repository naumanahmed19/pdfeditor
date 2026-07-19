import type { ToolKind } from "../types";

export interface ModifyPermissions {
  restricted: boolean;
  modify: boolean;
}

/** Native PDF content is movable only in the unified selector and only when
 * the document permits structural modification. */
export function canMoveNativeContent(
  tool: ToolKind,
  permissions: ModifyPermissions,
): boolean {
  return tool === "select" && (!permissions.restricted || permissions.modify);
}

/** Read mode keeps form widgets fillable. Move/select turns a writable widget
 * into a designer object, using the same modify-permission boundary as native
 * text and images. */
export function canMoveExistingFormField(
  tool: ToolKind,
  permissions: ModifyPermissions,
  readOnly: boolean,
): boolean {
  return !readOnly && canMoveNativeContent(tool, permissions);
}
