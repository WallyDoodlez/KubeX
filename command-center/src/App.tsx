/**
 * Code-split routes via React.lazy.
 *
 * Chunk sizes (npm run build output, Iteration 14, gzip):
 *   Dashboard         ~3.1 KB
 *   AgentsPanel       ~3.1 KB
 *   AgentDetailPage   ~2.0 KB  ← lazy-loaded, not in initial bundle
 *   ApprovalQueue     ~1.5 KB  ← lazy-loaded, not in initial bundle
 *   TrafficLog        ~2.0 KB
 *   OrchestratorChat  ~4.1 KB
 *   ContainersPanel   ~1.8 KB
 *   index (shared)    ~66 KB   (React + router + shared utils)
 *
 * All heavy pages are code-split. The initial bundle loads only Layout + routing shell.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { AppProvider, useAppContext } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import type { NavPage } from './types';

const LazyDashboard = lazy(() => import('./components/Dashboard'));
const LazyAgentsPanel = lazy(() => import('./components/AgentsPanel'));
const LazyTrafficLog = lazy(() => import('./components/TrafficLog'));
const LazyOrchestratorChat = lazy(() => import('./components/OrchestratorChat'));
const LazyContainersPanel = lazy(() => import('./components/ContainersPanel'));
const LazyAgentDetailPage = lazy(() => import('./components/AgentDetailPage'));
const LazyApprovalQueue = lazy(() => import('./components/ApprovalQueue'));

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
  const { trafficLog, clearTrafficLog } = useAppContext();
  return <LazyTrafficLog entries={trafficLog} onClear={clearTrafficLog} />;
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
      <AuthProvider>
      <AppProvider>
      <ToastProvider>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={LoadingFallback}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/agents" element={<LazyAgentsPanel />} />
                <Route path="/agents/:agentId" element={<LazyAgentDetailPage />} />
                <Route path="/traffic" element={<TrafficPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/containers" element={<LazyContainersPanel />} />
                <Route path="/approvals" element={<LazyApprovalQueue />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </ToastProvider>
      </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
