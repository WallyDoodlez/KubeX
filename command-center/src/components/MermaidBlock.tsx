import { useState, useEffect, useRef, memo } from 'react';
import mermaid from 'mermaid';

interface MermaidBlockProps {
  code: string;
}

const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize mermaid with dark theme
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#10b981',      // emerald-500
        primaryTextColor: '#e5e7eb',
        primaryBorderColor: '#374151',
        lineColor: '#6b7280',
        secondaryColor: '#1f2937',
        tertiaryColor: '#111827',
        background: '#0a0a0a',
        fontFamily: 'ui-monospace, monospace',
      },
      securityLevel: 'strict',
    });

    let cancelled = false;
    const id = `mermaid-${crypto.randomUUID().slice(0, 8)}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg(null);
        }
        // Clean up any orphaned element mermaid may have created
        const orphan = document.getElementById(id);
        orphan?.remove();
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    // Fallback: show raw code in a styled pre block
    return (
      <div data-testid="mermaid-fallback">
        <p className="text-[10px] text-red-400 mb-1">Diagram render failed</p>
        <pre className="text-sm bg-[var(--color-surface-dark)] rounded-lg p-3 overflow-x-auto border border-[var(--color-border)]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-[var(--color-text-muted)]">
        <span className="animate-pulse">⟳</span> Rendering diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="mermaid-diagram"
      className="my-2 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

export default MermaidBlock;
