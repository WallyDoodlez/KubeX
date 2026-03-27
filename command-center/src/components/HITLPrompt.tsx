import { useState } from 'react';

interface HITLPromptProps {
  prompt: string;
  taskId: string;
  onSubmit: (taskId: string, input: string) => void;
  disabled?: boolean;
  sourceAgent?: string;
}

export default function HITLPrompt({ prompt, taskId, onSubmit, disabled = false, sourceAgent }: HITLPromptProps) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!input.trim() || submitting || disabled) return;
    setSubmitting(true);
    onSubmit(taskId, input.trim());
    setInput('');
    setSubmitting(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  }

  return (
    <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
          {sourceAgent ? `${sourceAgent} — Input Required` : 'Input Required'}
        </span>
      </div>

      {/* Prompt text */}
      <p className="text-sm text-[#e2e8f0] mb-3 whitespace-pre-wrap">{prompt}</p>

      {/* Input area */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your response… (Ctrl+Enter to submit)"
          disabled={disabled || submitting}
          rows={2}
          className="
            flex-1 px-3 py-2 rounded-lg text-sm resize-none
            bg-[#1a1d27] border border-amber-500/30
            text-[#e2e8f0] placeholder-[#3a3f5a]
            focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/20
            disabled:opacity-50 transition-colors
          "
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || submitting || disabled}
          className="
            flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold
            bg-amber-500 text-white
            hover:bg-amber-400 active:bg-amber-600
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors self-end
          "
        >
          {submitting ? '…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
