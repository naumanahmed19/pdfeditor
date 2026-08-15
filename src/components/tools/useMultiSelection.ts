import { useEffect, useRef, useState } from "react";

export interface SelectionModifiers {
  toggle: boolean;
  range: boolean;
}

interface MultiSelectionOptions<Key> {
  onDelete?: (selectedKeys: ReadonlySet<Key>) => void;
}

const isEditableTarget = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable ||
      element?.matches("input, textarea, select") ||
      element?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'),
  );
};

/** Shared desktop-style selection for ordered tool grids and sidebars. */
export function useMultiSelection<Key>(
  orderedKeys: readonly Key[],
  options: MultiSelectionOptions<Key> = {},
) {
  const [selectedKeys, setSelectedKeys] = useState<Set<Key>>(() => new Set());
  const anchorRef = useRef<Key | null>(null);
  const keysRef = useRef(orderedKeys);
  const selectedRef = useRef(selectedKeys);
  const deleteRef = useRef(options.onDelete);
  keysRef.current = orderedKeys;
  selectedRef.current = selectedKeys;
  deleteRef.current = options.onDelete;

  const selectOnly = (key: Key) => {
    setSelectedKeys(new Set([key]));
    anchorRef.current = key;
  };

  const toggle = (key: Key, selected?: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const shouldSelect = selected ?? !next.has(key);
      if (shouldSelect) next.add(key);
      else next.delete(key);
      return next;
    });
    anchorRef.current = key;
  };

  const selectWithModifiers = (
    key: Key,
    index: number,
    modifiers: SelectionModifiers,
  ) => {
    const anchorIndex =
      anchorRef.current === null ? -1 : orderedKeys.indexOf(anchorRef.current);
    if (modifiers.range && anchorIndex >= 0) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      setSelectedKeys((current) => {
        const next = modifiers.toggle ? new Set(current) : new Set<Key>();
        for (let itemIndex = start; itemIndex <= end; itemIndex += 1) {
          next.add(orderedKeys[itemIndex]);
        }
        return next;
      });
      return;
    }
    if (modifiers.toggle) {
      toggle(key);
      return;
    }
    selectOnly(key);
  };

  const clear = () => {
    setSelectedKeys(new Set());
    anchorRef.current = null;
  };

  const selectAll = () => {
    setSelectedKeys(new Set(orderedKeys));
    anchorRef.current = orderedKeys[0] ?? null;
  };

  const allSelected = orderedKeys.length > 0 && selectedKeys.size === orderedKeys.length;
  const toggleAll = () => {
    if (allSelected) clear();
    else selectAll();
  };

  const replace = (keys: Iterable<Key>, anchor: Key | null = null) => {
    setSelectedKeys(new Set(keys));
    anchorRef.current = anchor;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        if (!keysRef.current.length) return;
        event.preventDefault();
        setSelectedKeys(new Set(keysRef.current));
        anchorRef.current = keysRef.current[0] ?? null;
        return;
      }
      if (event.key === "Escape" && selectedRef.current.size) {
        event.preventDefault();
        setSelectedKeys(new Set());
        anchorRef.current = null;
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedRef.current.size &&
        deleteRef.current
      ) {
        event.preventDefault();
        deleteRef.current(new Set(selectedRef.current));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    allSelected,
    clear,
    replace,
    selectAll,
    selectedKeys,
    setSelectedKeys,
    selectWithModifiers,
    toggle,
    toggleAll,
  };
}
