import { memo, useState, useEffect, useRef } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

// Wrapped in React.memo — SearchInput is rendered inside AgentsPanel which polls every 10s.
// Memo prevents re-rendering unless value/onChange/placeholder actually changes.
const SearchInput = memo(function SearchInput({ value, onChange, placeholder = 'Search…', debounceMs = 300 }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setLocalValue(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  }

  function handleClear() {
    setLocalValue('');
    onChange('');
    clearTimeout(timerRef.current);
  }

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="relative">
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="
          w-full pl-8 pr-8 py-2 rounded-lg text-sm
          bg-[var(--color-surface)] border border-[var(--color-border)]
          text-[var(--color-text)] placeholder-[var(--color-text-muted)]
          focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
          transition-colors
        "
      />
      {/* Search icon */}
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] text-sm pointer-events-none">
        ⌕
      </span>
      {/* Clear button */}
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] hover:text-[var(--color-text)] text-sm transition-colors"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
});

export default SearchInput;
