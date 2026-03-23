import React, { createContext, useContext, useMemo, useState } from 'react';
import { ChatMessage, ServiceHealth, TrafficEntry } from '../types';
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

export type SystemStatus = 'loading' | 'operational' | 'degraded' | 'critical';

interface AppContextValue {
  trafficLog: TrafficEntry[];
  addTrafficEntry: (entry: TrafficEntry) => void;
  clearTrafficLog: () => void;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  pendingApprovalCount: number;
  setPendingApprovalCount: (count: number) => void;
  // ── Global service health ──────────────────────────────────────────
  /** Live service health state shared across the whole app */
  services: ServiceHealth[];
  setServices: React.Dispatch<React.SetStateAction<ServiceHealth[]>>;
  /** Aggregate status derived from services */
  systemStatus: SystemStatus;
  /** Timestamp of the last completed health poll cycle; null until first poll */
  lastHealthPollAt: Date | null;
  setLastHealthPollAt: React.Dispatch<React.SetStateAction<Date | null>>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const INITIAL_SERVICES: ServiceHealth[] = [
  { name: 'Gateway',  url: 'localhost:8080', status: 'loading', responseTime: null, lastChecked: null },
  { name: 'Registry', url: 'localhost:8070', status: 'loading', responseTime: null, lastChecked: null },
  { name: 'Manager',  url: 'localhost:8090', status: 'loading', responseTime: null, lastChecked: null },
  { name: 'Broker',   url: 'internal',       status: 'loading', responseTime: null, lastChecked: null },
  { name: 'Redis',    url: 'localhost:6379', status: 'loading', responseTime: null, lastChecked: null },
];

/** Derive aggregate system status from a list of service health entries. */
export function deriveSystemStatus(services: ServiceHealth[]): SystemStatus {
  const nonLoading = services.filter((s) => s.status !== 'loading');
  if (nonLoading.length === 0) return 'loading';
  const downCount = nonLoading.filter((s) => s.status === 'down').length;
  const degradedCount = nonLoading.filter((s) => s.status === 'degraded').length;
  if (downCount >= 2 || (downCount >= 1 && degradedCount >= 1)) return 'critical';
  if (downCount >= 1 || degradedCount >= 1) return 'degraded';
  return 'operational';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [rawTrafficLog, setTrafficLog] = useLocalStorage<TrafficEntry[]>('kubex-traffic-log', []);
  const [rawChatMessages, setChatMessages] = useLocalStorage<ChatMessage[]>('kubex-chat-messages', [WELCOME_MESSAGE]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [services, setServices] = useState<ServiceHealth[]>(INITIAL_SERVICES);
  const [lastHealthPollAt, setLastHealthPollAt] = useState<Date | null>(null);

  // Rehydrate Date objects from JSON-parsed strings on every read.
  // useLocalStorage stores/retrieves via JSON.parse which converts Dates to ISO strings.
  // useMemo ensures we only rehydrate when the raw arrays change (not on every render).
  const trafficLog = useMemo(() => rehydrateTrafficEntries(rawTrafficLog), [rawTrafficLog]);
  const chatMessages = useMemo(() => rehydrateChatMessages(rawChatMessages), [rawChatMessages]);

  // Derive aggregate system status from live service states.
  const systemStatus = useMemo(() => deriveSystemStatus(services), [services]);

  function addTrafficEntry(entry: TrafficEntry) {
    setTrafficLog((prev) => [entry, ...prev].slice(0, 500));
  }

  function clearTrafficLog() {
    setTrafficLog([]);
  }

  return (
    <AppContext.Provider value={{ trafficLog, addTrafficEntry, clearTrafficLog, chatMessages, setChatMessages, pendingApprovalCount, setPendingApprovalCount, services, setServices, systemStatus, lastHealthPollAt, setLastHealthPollAt }}>
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
