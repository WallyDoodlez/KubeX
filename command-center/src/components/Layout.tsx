import type { ReactNode } from 'react';
import type { NavPage } from '../types';

interface NavItem {
  id: NavPage;
  label: string;
  icon: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', description: 'System overview' },
  { id: 'agents', label: 'Agents', icon: '◎', description: 'Registered agents' },
  { id: 'traffic', label: 'Traffic', icon: '⇌', description: 'Actions log' },
  { id: 'chat', label: 'Orchestrator', icon: '⌘', description: 'Dispatch tasks' },
  { id: 'containers', label: 'Containers', icon: '⬡', description: 'Docker kubexes' },
];

interface LayoutProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
  children: ReactNode;
}

export default function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f1117' }}>
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
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
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
            <span className="text-[#64748b] text-sm">
              {NAV_ITEMS.find((n) => n.id === currentPage)?.icon}
            </span>
            <h1 className="text-sm font-semibold text-[#e2e8f0]">
              {NAV_ITEMS.find((n) => n.id === currentPage)?.label}
            </h1>
            <span className="text-[#3a3f5a] text-sm">/</span>
            <span className="text-xs text-[#64748b]">
              {NAV_ITEMS.find((n) => n.id === currentPage)?.description}
            </span>
          </div>
          <div className="flex items-center gap-3">
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
