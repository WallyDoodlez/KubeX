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
import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { AppProvider, useAppContext } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';
import { SettingsProvider } from './hooks/useSettings';
import type { NavPage } from './types';

const LazyDashboard = lazy(() => import('./components/Dashboard'));
const LazyAgentsPanel = lazy(() => import('./components/AgentsPanel'));
const LazyTrafficLog = lazy(() => import('./components/TrafficLog'));
const LazyOrchestratorChat = lazy(() => import('./components/OrchestratorChat'));
const LazyContainersPanel = lazy(() => import('./components/ContainersPanel'));
const LazyAgentDetailPage = lazy(() => import('./components/AgentDetailPage'));
const LazyApprovalQueue = lazy(() => import('./components/ApprovalQueue'));
const LazySettingsPage = lazy(() => import('./components/SettingsPage'));
const LazyNotFoundPage = lazy(() => import('./components/NotFoundPage'));
const LazyAuthCallbackPage = lazy(() => import('./components/AuthCallbackPage'));
const LazyLoginPage = lazy(() => import('./components/LoginPage'));
const LazyTaskHistoryPage = lazy(() => import('./components/TaskHistoryPage'));
const LazySpawnWizard = lazy(() => import('./pages/SpawnWizard'));
const LazyPolicyCheckPage = lazy(() => import('./pages/PolicyCheckPage'));

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

function TasksPage() {
  const { trafficLog } = useAppContext();
  return <LazyTaskHistoryPage entries={trafficLog} />;
}

const LoadingFallback = (
  <div className="flex items-center justify-center h-full text-[#3a3f5a] text-sm">
    Loading…
  </div>
);

/**
 * ToastBridge — sits inside NotificationProvider so it can access
 * useNotifications() and pass addNotification to ToastProvider.
 */
function ToastBridge({ children }: { children: React.ReactNode }) {
  const { addNotification } = useNotifications();
  return (
    <ToastProvider onToastAdded={addNotification}>
      {children}
    </ToastProvider>
  );
}

/**
 * OAuthGate — when OAuth is configured and the user is NOT authenticated,
 * render the login page instead of the app shell.
 * The /auth/callback route is always rendered regardless of auth state
 * (it's how the user becomes authenticated).
 */
function OAuthGate({ children }: { children: React.ReactNode }) {
  const { oauthEnabled, isAuthenticated } = useAuth();

  // OAuth callback page — always accessible
  const isCallbackRoute = window.location.pathname.startsWith('/auth/callback');
  if (isCallbackRoute) {
    return (
      <Suspense fallback={LoadingFallback}>
        <LazyAuthCallbackPage />
      </Suspense>
    );
  }

  if (oauthEnabled && !isAuthenticated) {
    return (
      <Suspense fallback={LoadingFallback}>
        <LazyLoginPage />
      </Suspense>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
      <AppProvider>
      <SettingsProvider>
      <NotificationProvider>
      <ToastBridge>
        <OAuthGate>
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
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/spawn" element={<LazySpawnWizard />} />
                  <Route path="/policy-check" element={<LazyPolicyCheckPage />} />
                  <Route path="/settings" element={<LazySettingsPage />} />
                  <Route path="/auth/callback" element={<LazyAuthCallbackPage />} />
                  <Route path="*" element={<LazyNotFoundPage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </Layout>
        </OAuthGate>
      </ToastBridge>
      </NotificationProvider>
      </SettingsProvider>
      </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
