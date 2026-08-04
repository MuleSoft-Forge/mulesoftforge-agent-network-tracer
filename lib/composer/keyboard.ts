/** Keyboard shortcut matching for the Builder shell. */

export type ShortcutId = "undo" | "redo" | "commandPalette" | "canvasSearch" | "closeOverlay";

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Monaco ships its own undo stack and find widget, so shortcuts inside it must
 * fall through. Plain inputs/textareas are controlled by our reducer, where
 * native undo does not work, so app-level undo intentionally applies there.
 */
export function isEditorSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".monaco-editor") !== null;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (target as HTMLElement).isContentEditable === true
  );
}

export function resolveShortcut(event: KeyEventLike): ShortcutId | null {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (key === "escape") return "closeOverlay";
  if (!mod || event.altKey) return null;

  switch (key) {
    case "z":
      return event.shiftKey ? "redo" : "undo";
    case "y":
      return "redo";
    case "k":
      return event.shiftKey ? null : "commandPalette";
    case "f":
      return event.shiftKey ? null : "canvasSearch";
    default:
      return null;
  }
}
