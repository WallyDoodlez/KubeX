/**
 * GlobalProgressBar — thin NProgress-style bar at the very top of the viewport.
 *
 * - Fixed position, top: 0, z-index 50, full width
 * - Emerald gradient matching the app theme
 * - Slides from 0 → ~85% while loading, then snaps to 100% and fades out
 * - Invisible when no fetches are active
 */

import { useEffect, useRef, useState } from 'react';
import { useLoadingCount } from '../context/LoadingContext';

type BarState = 'hidden' | 'loading' | 'completing' | 'fading';

export default function GlobalProgressBar() {
  const count = useLoadingCount();
  const [barState, setBarState] = useState<BarState>('hidden');
  const [width, setWidth] = useState(0);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear all pending timers
  function clearTimers() {
    if (completeTimer.current) clearTimeout(completeTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    if (tickTimer.current) clearTimeout(tickTimer.current);
  }

  useEffect(() => {
    if (count > 0) {
      // Start or continue loading
      clearTimers();
      setBarState('loading');
      setWidth(10);

      // Increment width incrementally up to ~85%
      let currentWidth = 10;
      function tick() {
        currentWidth = Math.min(85, currentWidth + Math.random() * 12 + 4);
        setWidth(currentWidth);
        if (currentWidth < 85) {
          tickTimer.current = setTimeout(tick, 400 + Math.random() * 200);
        }
      }
      tickTimer.current = setTimeout(tick, 300);
    } else {
      // Fetches done — complete to 100%, then fade out
      if (barState === 'hidden') return;

      clearTimers();
      setBarState('completing');
      setWidth(100);

      completeTimer.current = setTimeout(() => {
        setBarState('fading');
        fadeTimer.current = setTimeout(() => {
          setBarState('hidden');
          setWidth(0);
        }, 300);
      }, 200);
    }

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  if (barState === 'hidden') return null;

  return (
    <div
      data-testid="global-progress-bar"
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          background: 'linear-gradient(90deg, #10b981, #06b6d4)',
          transition: barState === 'completing'
            ? 'width 200ms ease-out'
            : barState === 'fading'
              ? 'opacity 300ms ease-out'
              : 'width 400ms ease-out',
          opacity: barState === 'fading' ? 0 : 1,
          boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
          borderRadius: '0 2px 2px 0',
        }}
      />
    </div>
  );
}
