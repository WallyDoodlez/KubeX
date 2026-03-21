import { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AgentsPanel from './components/AgentsPanel';
import TrafficLog from './components/TrafficLog';
import OrchestratorChat from './components/OrchestratorChat';
import ContainersPanel from './components/ContainersPanel';
import type { NavPage, TrafficEntry, ChatMessage } from './types';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'system',
  content:
    'KubexClaw Command Center — dispatch tasks to the orchestrator via the Gateway. Enter a capability and message below.',
  timestamp: new Date(),
};

export default function App() {
  const [page, setPage] = useState<NavPage>('dashboard');
  const [trafficLog, setTrafficLog] = useState<TrafficEntry[]>([]);
  // Chat messages lifted here so they persist across page navigation
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);

  function addTrafficEntry(entry: TrafficEntry) {
    setTrafficLog((prev) => [entry, ...prev].slice(0, 500));
  }

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {/* Render all pages but only show the active one — keeps chat state alive */}
      <div className={page === 'dashboard' ? '' : 'hidden'}>
        <Dashboard onNavigate={setPage} />
      </div>
      <div className={page === 'agents' ? '' : 'hidden'}>
        <AgentsPanel />
      </div>
      <div className={page === 'traffic' ? '' : 'hidden'}>
        <TrafficLog entries={trafficLog} />
      </div>
      <div className={page === 'chat' ? 'h-full' : 'hidden'}>
        <OrchestratorChat
          onTrafficEntry={addTrafficEntry}
          messages={chatMessages}
          setMessages={setChatMessages}
        />
      </div>
      <div className={page === 'containers' ? '' : 'hidden'}>
        <ContainersPanel />
      </div>
    </Layout>
  );
}
