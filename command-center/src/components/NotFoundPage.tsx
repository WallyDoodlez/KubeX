import { useNavigate } from 'react-router-dom';

/**
 * NotFoundPage — rendered for any unmatched route (catch-all *).
 *
 * Matches the app dark theme using CSS custom properties.
 * Provides a clear message and a single escape hatch back to the Dashboard.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6 px-6 text-center"
      data-testid="not-found-page"
    >
      {/* Large 404 glyph */}
      <div
        className="text-8xl font-bold select-none"
        style={{ color: 'var(--accent-primary)', opacity: 0.35 }}
        aria-hidden="true"
      >
        404
      </div>

      {/* Heading */}
      <h1
        className="text-2xl font-semibold"
        style={{ color: 'var(--text-primary)' }}
        data-testid="not-found-heading"
      >
        Page not found
      </h1>

      {/* Description */}
      <p
        className="text-sm max-w-xs"
        style={{ color: 'var(--text-secondary)' }}
        data-testid="not-found-description"
      >
        The route you requested doesn&apos;t exist. It may have been moved or
        you may have followed a broken link.
      </p>

      {/* CTA */}
      <button
        onClick={() => navigate('/')}
        className="px-5 py-2 rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          backgroundColor: 'var(--accent-primary)',
          color: '#ffffff',
        }}
        data-testid="not-found-home-link"
        aria-label="Go back to Dashboard"
      >
        ← Back to Dashboard
      </button>
    </div>
  );
}
