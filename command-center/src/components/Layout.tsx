import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { killAllKubexes, getKubexes } from '../api';
import KillAllDialog from './KillAllDialog';
import QuickActionsMenu from './QuickActionsMenu';
import Toast from './Toast';

interface NavItem {
  label: string;
  icon: string;
  description: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',   icon: '◈', description: 'System overview',   path: '/'          },
  { label: 'Agents',      icon: '◎', description: 'Registered agents', path: '/agents'    },
  { label: 'Traffic',     icon: '⇌', description: 'Actions log',       path: '/traffic'   },
  { label: 'Orchestrator',icon: '⌘', description: 'Dispatch tasks',    path: '/chat'      },
  { label: 'Containers',  icon: '⬡', description: 'Docker kubexes',    path: '/containers'},
  { label: 'Approvals',   icon: '⚑', description: 'Escalated actions', path: '/approvals' },
];

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pendingApprovalCount } = useAppContext();
  const { addToast } = useToast();

  const [killAllOpen, setKillAllOpen] = useState(false);
  const [killAllLoading, setKillAllLoading] = useState(false);
  const [kubexCount, setKubexCount] = useState<number | undefined>(undefined);

  const currentItem = NAV_ITEMS.find((n) => n.path === location.pathname) ?? NAV_ITEMS[0];

  async function openKillAllDialog() {
    // Pre-fetch count so dialog can show it
    const res = await getKubexes();
    if (res.ok && res.data) {
      const running = res.data.filter((k) => k.status === 'running').length;
      setKubexCount(running);
    } else {
      setKubexCount(undefined);
    }
    setKillAllOpen(true);
  }

  async function handleKillAll() {
    setKillAllLoading(true);
    const res = await killAllKubexes();
    setKillAllLoading(false);
    setKillAllOpen(false);
    if (res.ok) {
      addToast('All kubexes have been killed', 'success');
    } else {
      addToast(`Kill all failed: ${res.error ?? 'Unknown error'}`, 'error');
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f1117' }}>
      {/* Toast notifications (portal-like, fixed position) */}
      <Toast />

      {/* Kill All confirmation dialog */}
      <KillAllDialog
        isOpen={killAllOpen}
        onClose={() => setKillAllOpen(false)}
        onConfirm={handleKillAll}
        kubexCount={kubexCount}
        isLoading={killAllLoading}
      />

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-[#2a2f45] bg-[#12151f]">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-[#2a2f45]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-sm font-bold text-white">
              K
            </div>
            <div>
              <p className="text-sm font-bold text-[#e2e8f0] leading-none">KubexClaw</p>
              <p className="text-xs text-[#64748b] leading-none mt-0.5">Command Center</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          <p className="px-2 mb-2 text-[10px] uppercase tracking-widest font-semibold text-[#3a3f5a]">
            Navigation
          </p>
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-left transition-all
                  ${active
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                    : 'text-[#64748b] hover:bg-[#1a1d27] hover:text-[#94a3b8] border border-transparent'
                  }
                `}
              >
                <span className={`text-base w-5 text-center flex-shrink-0 ${active ? 'text-emerald-400' : ''}`}>
                  {item.icon}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium leading-none ${active ? 'text-emerald-300' : ''}`}>
                    {item.label}
                  </p>
                  <p className="text-[10px] text-[#3a3f5a] leading-none mt-0.5 truncate">
                    {item.description}
                  </p>
                </div>
                {item.label === 'Approvals' && pendingApprovalCount > 0 && !active && (
                  <span className="ml-auto text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-1.5 py-0.5 flex-shrink-0">
                    {pendingApprovalCount}
                  </span>
                )}
                {active && (
                  <span className="ml-auto w-1 h-4 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#2a2f45]">
          <p className="text-[10px] text-[#3a3f5a] font-mono-data">v1.1 · stem cell kubex</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex-shrink-0 h-12 border-b border-[#2a2f45] bg-[#12151f] flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="text-[#64748b] text-sm">{currentItem.icon}</span>
            <h1 className="text-sm font-semibold text-[#e2e8f0]">{currentItem.label}</h1>
            <span className="text-[#3a3f5a] text-sm">/</span>
            <span className="text-xs text-[#64748b]">{currentItem.description}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Emergency Controls */}
            <QuickActionsMenu />
            <button
              onClick={openKillAllDialog}
              data-testid="kill-all-button"
              aria-label="Kill all kubexes"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 hover:border-red-500/50 transition-all"
            >
              <span>⏹</span>
              <span>Kill All</span>
            </button>

            <div className="w-px h-4 bg-[#2a2f45]" />

            <span className="text-xs text-[#3a3f5a] font-mono-data">
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono-data">live</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </div>
      </main>
    </div>
  );
}
