import { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import AgentsPanel from './components/AgentsPanel';
import TrafficLog from './components/TrafficLog';
import OrchestratorChat from './components/OrchestratorChat';
import ContainersPanel from './components/ContainersPanel';
import type { NavPage, TrafficEntry } from './types';

export default function App() {
  const [page, setPage] = useState<NavPage>('dashboard');
  // Shared traffic log — entries are added by OrchestratorChat dispatches
  const [trafficLog, setTrafficLog] = useState<TrafficEntry[]>([]);

  function addTrafficEntry(entry: TrafficEntry) {
    setTrafficLog((prev) => [entry, ...prev].slice(0, 500));
  }

  function renderPage() {
    switch (page) {
      case 'dashboard':
        return <Dashboard onNavigate={setPage} />;
      case 'agents':
        return <AgentsPanel />;
      case 'traffic':
        return <TrafficLog entries={trafficLog} />;
      case 'chat':
        return <OrchestratorChat onTrafficEntry={addTrafficEntry} />;
      case 'containers':
        return <ContainersPanel />;
      default:
        return <Dashboard onNavigate={setPage} />;
    }
  }

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {renderPage()}
    </Layout>
  );
}
