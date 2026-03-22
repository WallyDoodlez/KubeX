import React, { createContext, useContext, useMemo, useState } from 'react';
import { ChatMessage, TrafficEntry } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'system',
  content: 'KubexClaw Command Center — dispatch tasks to the orchestrator via the Gateway. Enter a capability and message below.',
  timestamp: new Date(),
};

/** Rehydrate date strings from JSON.parse back into Date objects. */
function rehydrateTrafficEntries(raw: TrafficEntry[]): TrafficEntry[] {
  return raw.map((e) => ({
    ...e,
    timestamp: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp as unknown as string),
  }));
}

function rehydrateChatMessages(raw: ChatMessage[]): ChatMessage[] {
  return raw.map((m) => ({
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as unknown as string),
  }));
}

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
  const [rawTrafficLog, setTrafficLog] = useLocalStorage<TrafficEntry[]>('kubex-traffic-log', []);
  const [rawChatMessages, setChatMessages] = useLocalStorage<ChatMessage[]>('kubex-chat-messages', [WELCOME_MESSAGE]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  // Rehydrate Date objects from JSON-parsed strings on every read.
  // useLocalStorage stores/retrieves via JSON.parse which converts Dates to ISO strings.
  // useMemo ensures we only rehydrate when the raw arrays change (not on every render).
  const trafficLog = useMemo(() => rehydrateTrafficEntries(rawTrafficLog), [rawTrafficLog]);
  const chatMessages = useMemo(() => rehydrateChatMessages(rawChatMessages), [rawChatMessages]);

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
