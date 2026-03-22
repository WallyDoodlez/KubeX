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
    stdout: 'text-[#e2e8f0]',
    stderr: 'text-red-400',
    system: 'text-[#64748b] italic',
  };

  return (
    <div className="rounded-xl border border-[#2a2f45] bg-[#0a0c10] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#12151f] border-b border-[#2a2f45]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-[#64748b] font-mono-data">{title}</span>
        </div>
        <span className="text-[10px] text-[#3a3f5a] font-mono-data">{lines.length} lines</span>
      </div>

      {/* Output area */}
      <div
        ref={containerRef}
        className="overflow-y-auto scrollbar-thin p-3 font-mono-data text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        {lines.length === 0 ? (
          <span className="text-[#3a3f5a]">Waiting for output…</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`${streamColors[line.stream]} whitespace-pre-wrap break-all`}>
              {line.timestamp && (
                <span className="text-[#3a3f5a] mr-2">[{line.timestamp}]</span>
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
