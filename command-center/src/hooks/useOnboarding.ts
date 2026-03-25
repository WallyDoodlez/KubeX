import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';

/**
 * useOnboarding — tracks first-run onboarding tour state in localStorage.
 *
 * - `tourCompleted`: true if the user has finished or dismissed the tour.
 * - `currentStep`: index of the currently active tour step (0-based).
 * - `startTour()`: reset and begin the tour from step 0.
 * - `nextStep()`: advance to the next step; marks complete if on the last step.
 * - `skipTour()`: immediately mark the tour as complete.
 * - `resetTour()`: wipe state so the tour will show again (e.g. from Settings).
 */

const STORAGE_KEY = 'kubex-onboarding';

interface OnboardingState {
  completed: boolean;
  currentStep: number;
  active: boolean;
}

const INITIAL: OnboardingState = {
  completed: false,
  currentStep: 0,
  active: false,
};

export const TOUR_STEP_COUNT = 8;

export function useOnboarding() {
  const [state, setState] = useLocalStorage<OnboardingState>(STORAGE_KEY, INITIAL);

  /** Begin tour from step 0 (called automatically on first render if not completed) */
  const startTour = useCallback(() => {
    setState({ completed: false, currentStep: 0, active: true });
  }, [setState]);

  /** Advance to the next step; auto-completes when past the last step */
  const nextStep = useCallback(() => {
    setState((prev) => {
      const next = prev.currentStep + 1;
      if (next >= TOUR_STEP_COUNT) {
        return { completed: true, currentStep: 0, active: false };
      }
      return { ...prev, currentStep: next };
    });
  }, [setState]);

  /** Skip the tour entirely */
  const skipTour = useCallback(() => {
    setState({ completed: true, currentStep: 0, active: false });
  }, [setState]);

  /** Reset tour so it shows again (useful from Settings) */
  const resetTour = useCallback(() => {
    setState(INITIAL);
  }, [setState]);

  return {
    tourCompleted: state.completed,
    tourActive: state.active,
    currentStep: state.currentStep,
    startTour,
    nextStep,
    skipTour,
    resetTour,
  };
}
