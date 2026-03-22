import React, { createContext, useContext, useState } from 'react';
import { ChatMessage, TrafficEntry } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'system',
  content: 'KubexClaw Command Center — dispatch tasks to the orchestrator via the Gateway. Enter a capability and message below.',
  timestamp: new Date(),
};

interface AppContextValue {
  trafficLog: TrafficEntry[];
  addTrafficEntry: (entry: TrafficEntry) => void;
  clearTrafficLog: () => void;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  pendingApprovalCount: number;
  setPendingApprovalCount: (count: number) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [trafficLog, setTrafficLog] = useLocalStorage<TrafficEntry[]>('kubex-traffic-log', []);
  const [chatMessages, setChatMessages] = useLocalStorage<ChatMessage[]>('kubex-chat-messages', [WELCOME_MESSAGE]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  function addTrafficEntry(entry: TrafficEntry) {
    setTrafficLog((prev) => [entry, ...prev].slice(0, 500));
  }

  function clearTrafficLog() {
    setTrafficLog([]);
  }

  return (
    <AppContext.Provider value={{ trafficLog, addTrafficEntry, clearTrafficLog, chatMessages, setChatMessages, pendingApprovalCount, setPendingApprovalCount }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return ctx;
}

export { AppContext, WELCOME_MESSAGE };
