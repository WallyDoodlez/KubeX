import { useState, useCallback, useRef } from 'react';

export interface TableKeyboardNavOptions {
  /** Total number of rows currently rendered */
  rowCount: number;
  /** Called when Enter is pressed on a row — typically toggles expand */
  onEnter?: (index: number) => void;
  /** Called when Space is pressed on a row — typically toggles selection */
  onSpace?: (index: number) => void;
}

export interface RowProps {
  id: string;
  tabIndex: number;
  'aria-rowindex': number;
  'data-nav-index': number;
  onFocus: () => void;
}

export interface UseTableKeyboardNavReturn {
  /** Index of the currently focused row (-1 means nothing focused yet) */
  focusedIndex: number;
  /** Programmatically set focus index */
  setFocusedIndex: (index: number) => void;
  /** keyDown handler — attach to the table container element */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /**
   * Returns ARIA / interaction props for a row at position `index`.
   * Spread these onto the row's root element.
   *   `id`            — stable id for aria-activedescendant
   *   `tabIndex`      — 0 for focused row, -1 for others
   *   `aria-rowindex` — 1-based row index (ARIA grid)
   *   `data-nav-index`— raw 0-based index for test targeting
   *   `onFocus`       — syncs internal state when row is mouse-focused
   */
  getRowProps: (index: number, tableId: string) => RowProps;
  /** aria-activedescendant value — attach to the table container */
  activeDescendant: string | undefined;
}

/**
 * Manages keyboard navigation for a flat list table.
 *
 * Keyboard map:
 *   ArrowDown  — move focus to next row (wraps at end)
 *   ArrowUp    — move focus to previous row (wraps at start)
 *   Home       — move focus to first row
 *   End        — move focus to last row
 *   Enter      — call onEnter(focusedIndex)  (e.g., expand row)
 *   Space      — call onSpace(focusedIndex)  (e.g., toggle selection)
 *
 * The hook does NOT imperatively focus DOM elements — the caller is
 * responsible for scrolling/focusing as needed. The hook exposes
 * `focusedIndex` so the caller can apply a visible focus ring via CSS.
 */
export function useTableKeyboardNav({
  rowCount,
  onEnter,
  onSpace,
}: TableKeyboardNavOptions): UseTableKeyboardNavReturn {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  // Keep a ref so the keyDown handler always reads the latest value without
  // requiring it to be in the dependency array (avoids stale closures).
  const focusedIndexRef = useRef<number>(-1);

  const updateFocus = useCallback((index: number) => {
    focusedIndexRef.current = index;
    setFocusedIndex(index);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rowCount === 0) return;

      const current = focusedIndexRef.current;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = current < 0 ? 0 : Math.min(current + 1, rowCount - 1);
          updateFocus(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = current < 0 ? rowCount - 1 : Math.max(current - 1, 0);
          updateFocus(prev);
          break;
        }
        case 'Home': {
          e.preventDefault();
          updateFocus(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          updateFocus(rowCount - 1);
          break;
        }
        case 'Enter': {
          if (current >= 0 && onEnter) {
            e.preventDefault();
            onEnter(current);
          }
          break;
        }
        case ' ': {
          if (current >= 0 && onSpace) {
            e.preventDefault();
            onSpace(current);
          }
          break;
        }
        default:
          break;
      }
    },
    [rowCount, onEnter, onSpace, updateFocus],
  );

  const getRowProps = useCallback(
    (index: number, tableId: string): RowProps => ({
      id: `${tableId}-row-${index}`,
      tabIndex: index === focusedIndex ? 0 : -1,
      'aria-rowindex': index + 1,
      'data-nav-index': index,
      onFocus: () => updateFocus(index),
    }),
    [focusedIndex, updateFocus],
  );

  const activeDescendant =
    focusedIndex >= 0 ? undefined : undefined; // resolved by caller with tableId

  return {
    focusedIndex,
    setFocusedIndex: updateFocus,
    handleKeyDown,
    getRowProps,
    activeDescendant,
  };
}
