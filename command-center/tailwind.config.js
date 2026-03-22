/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        kubex: {
          // Background layers — reference CSS custom properties so they can be
          // overridden via :root without touching component code.
          bg:           'var(--color-bg)',
          terminal:     'var(--color-bg-terminal)',
          'surface-dark':'var(--color-surface-dark)',
          surface:      'var(--color-surface)',
          'surface-hover':'var(--color-surface-hover)',
          // Borders
          border:       'var(--color-border)',
          'border-strong':'var(--color-border-strong)',
          'border-hover':'var(--color-border-hover)',
          // Text
          text:         'var(--color-text)',
          secondary:    'var(--color-text-secondary)',
          dim:          'var(--color-text-dim)',
          muted:        'var(--color-text-muted)',
          // Semantic accent colors (not tokenised — they come from Tailwind's
          // built-in palette and are referenced by name in components already)
          emerald: '#10b981',
          red:     '#ef4444',
          amber:   '#f59e0b',
          blue:    '#3b82f6',
          purple:  '#8b5cf6',
          cyan:    '#06b6d4',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
