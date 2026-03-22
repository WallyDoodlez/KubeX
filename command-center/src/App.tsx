import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import { AppProvider, useAppContext } from './context/AppContext';
import type { NavPage } from './types';

const LazyDashboard = lazy(() => import('./components/Dashboard'));
const LazyAgentsPanel = lazy(() => import('./components/AgentsPanel'));
const LazyTrafficLog = lazy(() => import('./components/TrafficLog'));
const LazyOrchestratorChat = lazy(() => import('./components/OrchestratorChat'));
const LazyContainersPanel = lazy(() => import('./components/ContainersPanel'));

const PAGE_TO_PATH: Record<NavPage, string> = {
  dashboard: '/',
  agents: '/agents',
  traffic: '/traffic',
  chat: '/chat',
  containers: '/containers',
};

function DashboardPage() {
  const navigate = useNavigate();
  return (
    <LazyDashboard onNavigate={(page) => navigate(PAGE_TO_PATH[page] ?? '/')} />
  );
}

function TrafficPage() {
  const { trafficLog } = useAppContext();
  return <LazyTrafficLog entries={trafficLog} />;
}

function ChatPage() {
  const { addTrafficEntry, chatMessages, setChatMessages } = useAppContext();
  return (
    <LazyOrchestratorChat
      onTrafficEntry={addTrafficEntry}
      messages={chatMessages}
      setMessages={setChatMessages}
    />
  );
}

const LoadingFallback = (
  <div className="flex items-center justify-center h-full text-[#3a3f5a] text-sm">
    Loading…
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Layout>
          <Suspense fallback={LoadingFallback}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/agents" element={<LazyAgentsPanel />} />
              <Route path="/traffic" element={<TrafficPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/containers" element={<LazyContainersPanel />} />
            </Routes>
          </Suspense>
        </Layout>
      </AppProvider>
    </BrowserRouter>
  );
}
