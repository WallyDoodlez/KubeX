import { useEffect, useCallback } from 'react';

export interface KeyboardShortcut {
  key: string;
  /** modifier keys that must be held */
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** human-readable description shown in help overlay */
  description: string;
  /** if true, the shortcut fires even when an input/textarea is focused */
  allowInInput?: boolean;
  handler: (e: KeyboardEvent) => void;
}

/**
 * Registers global keyboard shortcuts.
 * Each shortcut specifies its own modifier requirements.
 * Shortcuts are removed when the component that registered them unmounts.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const target = e.target as HTMLElement;
        const inInput =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;

        if (inInput && !shortcut.allowInInput) continue;

        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey);
        const shiftMatch = !!shortcut.shift === e.shiftKey;
        const altMatch = !!shortcut.alt === e.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.handler(e);
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
