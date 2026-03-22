import { useEffect, useRef } from 'react';

interface OutputLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
  timestamp?: string;
}

interface TerminalOutputProps {
  lines: OutputLine[];
  maxHeight?: string;
  title?: string;
}

export default function TerminalOutput({ lines, maxHeight = '400px', title = 'Live Output' }: TerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const streamColors = {
    stdout: 'text-[var(--color-text)]',
    stderr: 'text-red-400',
    system: 'text-[var(--color-text-dim)] italic',
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-terminal)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surface-dark)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-[var(--color-text-dim)] font-mono-data">{title}</span>
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)] font-mono-data">{lines.length} lines</span>
      </div>

      {/* Output area */}
      <div
        ref={containerRef}
        className="overflow-y-auto scrollbar-thin p-3 font-mono-data text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        {lines.length === 0 ? (
          <span className="text-[var(--color-text-muted)]">Waiting for output…</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`${streamColors[line.stream]} whitespace-pre-wrap break-all`}>
              {line.timestamp && (
                <span className="text-[var(--color-text-muted)] mr-2">[{line.timestamp}]</span>
              )}
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type { OutputLine };
