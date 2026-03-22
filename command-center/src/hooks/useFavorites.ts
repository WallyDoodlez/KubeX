import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';

const STORAGE_KEY = 'kubex-favorite-agents';

/**
 * Manages a set of favorited agent IDs persisted in localStorage.
 * Favorited agents should be surfaced at the top of agent lists.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useLocalStorage<string[]>(STORAGE_KEY, []);

  const isFavorite = useCallback(
    (agentId: string): boolean => {
      return favorites.includes(agentId);
    },
    [favorites],
  );

  const toggle = useCallback(
    (agentId: string) => {
      setFavorites((prev) => {
        if (prev.includes(agentId)) {
          return prev.filter((id) => id !== agentId);
        }
        return [...prev, agentId];
      });
    },
    [setFavorites],
  );

  const favoritesSet = new Set(favorites);

  return { favorites, favoritesSet, isFavorite, toggle };
}
