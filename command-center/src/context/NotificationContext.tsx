import React, { createContext, useCallback, useContext, useState } from 'react';
import type { ToastType } from './ToastContext';

// ── Types ─────────────────────────────────────────────────────────────

export interface NotificationEntry {
  id: string;
  message: string;
  type: ToastType;
  timestamp: Date;
  read: boolean;
}

interface NotificationContextValue {
  notifications: NotificationEntry[];
  unreadCount: number;
  addNotification: (message: string, type?: ToastType) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

// ── Context ───────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const MAX_NOTIFICATIONS = 100;

// ── Provider ──────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);

  const addNotification = useCallback(
    (message: string, type: ToastType = 'info') => {
      const entry: NotificationEntry = {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message,
        type,
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => {
        const next = [entry, ...prev];
        return next.slice(0, MAX_NOTIFICATIONS);
      });
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}
