# Command Center Changelog

> Tracks what changed in each iteration. Updated after every iteration completes.

---

## Iteration 27: 404 catch-all route + favicon + PWA manifest
**Files created:** `src/components/NotFoundPage.tsx`, `public/favicon.svg`, `public/manifest.json`, `tests/e2e/not-found.spec.ts`
**Files modified:** `src/App.tsx`, `index.html`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `NotFoundPage.tsx` — fully themed 404 page with decorative glyph, "Page not found" heading, description, and "← Back to Dashboard" CTA button; uses CSS custom property tokens so it respects dark/light theme
- Added `<Route path="*" element={<LazyNotFoundPage />} />` as the last route in the catch-all position in `App.tsx` (lazy-loaded, ~0.58 KB gzip)
- Created `public/favicon.svg` — KubexClaw "K" letterform in emerald-to-cyan gradient on a dark rounded-square background; replaces the placeholder gear emoji inline SVG
- Created `public/manifest.json` — PWA web app manifest: name, short_name, standalone display, `#10b981` theme, `#0f1117` background, SVG icon
- Updated `index.html` — proper `/favicon.svg` `<link>`, `apple-touch-icon`, manifest link, `theme-color` meta, `description` meta, `color-scheme` meta, Open Graph title/description/type tags
- Created `tests/e2e/not-found.spec.ts` — 19 tests covering: 404 page renders for unknown routes, heading text, description, CTA button, navigation back to Dashboard, 404 glyph in DOM, layout sidebar presence, known routes not showing 404, deeply nested unknown route, manifest served with correct JSON, manifest fields (name, colors, display, icons), favicon SVG served, HTML references manifest, theme-color meta tag, description meta tag
**Tests:** 363 → 382

---

## Iteration 1: Test Infrastructure + React Router
**Commit:** `992d503`
**Files created:** `playwright.config.ts`, `src/context/AppContext.tsx`, `tests/e2e/mocks/handlers.ts`, `tests/e2e/smoke.spec.ts`
**Files modified:** `package.json`, `vite.config.ts`, `src/App.tsx`, `src/components/Layout.tsx`
**Changes:**
- Installed vitest, @playwright/test, msw, react-router-dom, @testing-library/react
- Configured Vitest in vite.config.ts with jsdom environment and test-setup.ts
- Created playwright.config.ts for E2E test runner
- Created AppContext for shared state (agents, kubexes, trafficLog, chatMessages)
- Refactored App.tsx to use BrowserRouter + Routes + React.lazy + Suspense
- Refactored Layout.tsx to use useNavigate/useLocation instead of state callbacks
- Created MSW mock API handlers for all endpoints
- Created 4 smoke tests: load, navigation, route rendering, direct URL access
**Tests:** 0 → 4

---

## Iteration 2: Custom Hooks + Interval Cleanup + Error Boundaries
**Commit:** `0a4d8c5`
**Files created:** `src/hooks/usePolling.ts`, `src/hooks/useApiCall.ts`, `src/components/ErrorBoundary.tsx`, `tests/e2e/error-recovery.spec.ts`
**Files modified:** `src/components/Dashboard.tsx`, `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `src/components/OrchestratorChat.tsx`, `src/App.tsx`
**Changes:**
- Created usePolling hook with cleanup on unmount, exponential backoff, and pause-on-tab-hidden
- Created useApiCall hook for one-shot API calls with loading/error state
- Created ErrorBoundary component with catch-render-errors + retry UI
- Refactored Dashboard.tsx to replace setInterval with usePolling
- Refactored AgentsPanel.tsx to replace setInterval with usePolling
- Refactored ContainersPanel.tsx to replace setInterval with usePolling
- Fixed memory leak in OrchestratorChat.tsx (uncleared setInterval in handleSend), wired usePolling
- Wrapped routes in ErrorBoundary in App.tsx
- Created 3 error-recovery tests
**Tests:** 4 → 7

---

## Iteration 3: API Hardening + Auth + Input Validation
**Commit:** `a3be364`
**Files created:** `src/context/AuthContext.tsx`, `src/components/AuthGate.tsx`, `src/components/ConfirmDialog.tsx`, `src/utils/validation.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/validation.spec.ts`
**Files modified:** `src/api.ts`, `src/components/OrchestratorChat.tsx`, `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`
**Changes:**
- Hardened src/api.ts: removed `changeme` token default, added request deduplication, 401/403 detection
- Created AuthContext for manager token state management
- Created AuthGate component for token input when env var is missing
- Created ConfirmDialog accessible modal to replace all window.confirm calls
- Created validation.ts with validateCapability and validateMessage functions
- Added inline validation errors to OrchestratorChat.tsx, disabled send on invalid input
- Replaced window.confirm in AgentsPanel.tsx and ContainersPanel.tsx with ConfirmDialog
- Created 6 auth and validation tests
**Tests:** 7 → 13

---

## Iteration 4: Dashboard Enhancement
**Commit:** `dedce21`
**Files created:** `src/hooks/useTimeSeries.ts`, `src/components/Sparkline.tsx`, `tests/e2e/dashboard.spec.ts`
**Files modified:** `src/components/Dashboard.tsx`, `src/components/ServiceCard.tsx`
**Changes:**
- Created useTimeSeries hook to accumulate data points for sparklines
- Created Sparkline component using SVG polyline (no chart library dependency)
- Upgraded Dashboard.tsx with sparklines, clickable stat cards, "Last updated Xs ago" display, and "+N more" link
- Upgraded ServiceCard.tsx with response time sparkline history
- Created 6 dashboard tests
**Tests:** 13 → 19

---

## Iteration 5: AgentsPanel — Search, Filter, Pagination
**Commit:** `af9e665`
**Files created:** `src/hooks/usePagination.ts`, `src/hooks/useSearch.ts`, `src/hooks/useSort.ts`, `src/components/SearchInput.tsx`, `src/components/Pagination.tsx`, `tests/e2e/agents.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`
**Changes:**
- Created usePagination hook for page state management
- Created useSearch hook for debounced text filtering
- Created useSort hook for column sort state
- Created SearchInput component with debounce and clear button
- Created Pagination component with prev/next, page indicator, and page size selector
- Upgraded AgentsPanel.tsx with integrated search, sort, pagination, and ARIA table roles
- Created 8 agents tests
**Tests:** 19 → 27

---

## Iteration 6: Traffic Log Upgrade + Persistence
**Commit:** `a97eb24`
**Files created:** `src/hooks/useLocalStorage.ts`, `src/components/TrafficFilterBar.tsx`, `tests/e2e/traffic.spec.ts`
**Files modified:** `src/context/AppContext.tsx`, `src/components/TrafficLog.tsx`, `src/types.ts`
**Changes:**
- Created useLocalStorage hook for type-safe localStorage read/write
- Updated AppContext to persist trafficLog and chatMessages to localStorage
- Created TrafficFilterBar component with status, agent, time range, and search filters
- Upgraded TrafficLog.tsx with filter bar, pagination, clear log action, and entry count display
- Added TrafficFilter type to types.ts
- Created 7 traffic tests
**Tests:** 27 → 34

---

## Iteration 7: Agent Detail View (New Page)
**Commit:** `dd87efd`
**Files created:** `src/components/Tabs.tsx`, `src/components/AgentDetailPage.tsx`, `tests/e2e/agent-detail.spec.ts`
**Files modified:** `src/App.tsx`, `src/components/AgentsPanel.tsx`, `src/types.ts`
**Changes:**
- Created Tabs component with keyboard navigation and role=tablist ARIA semantics
- Created AgentDetailPage with Overview, Actions, and Config tabs
- Added `/agents/:agentId` route in App.tsx
- Made AgentsPanel rows clickable to navigate to agent detail
- Updated types.ts with NavPage and AgentDetail interface
- Created 7 agent-detail tests
**Tests:** 34 → 41

---

## Iteration 8: SSE Live Streaming + Terminal Renderer + HITL
**Commit:** `8d17778`
**Files created:** `src/hooks/useSSE.ts`, `src/components/TerminalOutput.tsx`, `src/components/HITLPrompt.tsx`, `tests/e2e/streaming.spec.ts`
**Files modified:** `src/components/OrchestratorChat.tsx`, `src/components/AgentDetailPage.tsx`, `src/types.ts`, `src/components/StatusBadge.tsx`, `src/api.ts`
**Changes:**
- Created useSSE hook with EventSource lifecycle management, reconnect logic, and final event handling
- Created TerminalOutput component for monospace stdout/stderr rendering with auto-scroll
- Created HITLPrompt component for awaiting_input prompt card with POST /actions submission
- Upgraded OrchestratorChat.tsx to switch from polling to SSE, embedded TerminalOutput + HITLPrompt
- Added "Live Output" tab to AgentDetailPage.tsx
- Added SSEChunk, HITLRequest types and new agent states (booting, credential_wait, ready) to types.ts
- Updated StatusBadge.tsx with colors for new lifecycle states
- Added getTaskStream() and provideInput() to api.ts
- Created 8 streaming tests
**Tests:** 41 → 49

---

## Iteration 9: Approval Queue (New Page)
**Commit:** `7d4efbb`
**Files created:** `src/components/ApprovalQueue.tsx`, `tests/e2e/approvals.spec.ts`
**Files modified:** `src/api.ts`, `src/components/Layout.tsx`, `src/App.tsx`, `src/context/AppContext.tsx`, `src/types.ts`
**Changes:**
- Created ApprovalQueue component with card list, approve/reject actions, and time ticker
- Added getEscalations() and resolveEscalation() to api.ts
- Added "Approvals" nav item with unread count badge to Layout.tsx
- Added `/approvals` route in App.tsx
- Added pendingApprovalCount derived state to AppContext.tsx
- Added ApprovalRequest and ApprovalDecision types to types.ts
- Created 7 approvals tests
**Tests:** 49 → 56

---

## Iteration 10: Emergency Controls (Top Bar)
**Commit:** `20c1278`
**Files created:** `src/components/KillAllDialog.tsx`, `src/components/QuickActionsMenu.tsx`, `src/components/Toast.tsx`, `src/context/ToastContext.tsx`, `tests/e2e/controls.spec.ts`
**Files modified:** `src/api.ts`, `src/components/Layout.tsx`
**Changes:**
- Created KillAllDialog with typed "KILL ALL" text confirmation before execution
- Created QuickActionsMenu dropdown with per-kubex action list
- Created Toast component with auto-dismiss notifications
- Created ToastContext for toast state management
- Added killAllKubexes(), pauseKubex(), resumeKubex() to api.ts
- Wired emergency controls into Layout.tsx top bar
- Created 8 controls tests
**Tests:** 56 → 64

---

## Iteration 11: Polish + Accessibility Audit
**Commit:** `b330482`
**Files created:** `src/components/SkeletonLoader.tsx`, `src/components/EmptyState.tsx`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/responsive.spec.ts`, `tests/e2e/integration.spec.ts`
**Files modified:** `src/components/Layout.tsx`, `src/index.css`
**Changes:**
- Created SkeletonLoader with reusable SkeletonTable, SkeletonCard, and SkeletonText variants
- Created EmptyState reusable component
- Upgraded Layout.tsx with skip-to-content link, aria-current, responsive sidebar, and landmark roles
- Audited all components for focus-visible rings, ARIA labels, and semantic HTML
- Updated index.css with focus-visible utilities and print stylesheet
- Created accessibility tests (Playwright-native: landmarks, tab order, aria-current, focus)
- Created responsive tests (sidebar breakpoints at 375/768/1280/1920px)
- Created integration test for full user flow: dispatch → stream → HITL → traffic → persist
- Build verified clean; all 120/120 tests passed
**Tests:** 64 → 120

---

## Iteration 12: Wire AuthGate + Replace Polling with SSE in OrchestratorChat
**Commit:** `1b0b1d7`
**Files created:** `tests/e2e/authgate.spec.ts`
**Files modified:** `src/App.tsx`, `src/components/OrchestratorChat.tsx`, `src/api.ts`, `tests/e2e/streaming.spec.ts`
**Changes:**
- Wrapped App.tsx route tree with `<AuthGate>` so unauthenticated users see token prompt before any route renders (AuthGate was built in iteration 3 but was dead code)
- Removed manual setInterval polling loop from OrchestratorChat.tsx (pollIntervalRef, POLL_INTERVAL, POLL_MAX constants, and the setInterval block inside handleSend)
- Replaced polling with useSSE hook: after dispatchTask succeeds, passes task stream URL to useSSE; maps SSE chunk types (stdout, stderr, result, failed, cancelled, hitl_request) to addMessage calls and traffic entries
- Embedded TerminalOutput inside result bubble for incremental live rendering
- Embedded HITLPrompt inside OrchestratorChat when stream emits hitl_request chunk
- Updated spinner text to reflect SSE states: "Connecting…" / "Streaming…" / "Waiting for result…"
- Confirmed getTaskStream() returns bare URL string suitable for EventSource
- Created authgate.spec.ts (3 tests: no token shows gate, valid token shows app, env token bypasses gate)
- Extended streaming.spec.ts to assert OrchestratorChat no longer issues repeated poll requests after dispatch
- Build verified clean; 128/128 tests passed
**Tests:** 120 → 128

---

## Iteration 13: Replace Ad-hoc Loading/Empty States with SkeletonLoader + EmptyState
**Commit:** `8d1515c`
**Files created:** `tests/e2e/skeletons.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `src/components/AgentDetailPage.tsx`, `src/components/Dashboard.tsx`, `src/components/ApprovalQueue.tsx`
**Changes:**
- AgentsPanel.tsx: replaced inline animate-pulse skeleton with `<SkeletonTable rows={3} cols={5} />`; replaced local EmptyState function with shared component
- ContainersPanel.tsx: replaced inline animate-pulse skeleton with `<SkeletonTable rows={3} cols={5} />`; replaced local EmptyContainers function with shared component
- AgentDetailPage.tsx: replaced bespoke two-div loading shimmer with `<SkeletonCard />` + `<SkeletonText lines={4} />`; replaced ad-hoc error block with shared EmptyState with back-navigation action
- Dashboard.tsx: replaced inline animate-pulse loading span with SkeletonCard cards; replaced local EmptyState function with shared component
- ApprovalQueue.tsx: replaced hardcoded empty-state div with shared EmptyState; added loading state using SkeletonCard (2 cards)
- Deleted all local EmptyState/EmptyContainers function declarations that were copy-pasted into individual files
- Created skeletons.spec.ts: intercepts API routes with delayed handler; asserts aria-busy="true" skeleton elements appear during load; asserts they disappear and real content renders after response
- Build verified clean; 142/142 tests passed
**Tests:** 128 → 142

---

## Iteration 14: Performance Pass — React.memo, useMemo, Virtualized Lists
**Commit:** `6efd0fa`
**Files created:** `tests/e2e/performance.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `src/components/ApprovalQueue.tsx`, `src/components/OrchestratorChat.tsx`, `src/components/ServiceCard.tsx`, `src/components/StatusBadge.tsx`, `src/components/Sparkline.tsx`, `src/components/Pagination.tsx`, `src/components/SearchInput.tsx`, `src/components/TrafficLog.tsx`, `src/context/AppContext.tsx`, `src/App.tsx`
**Changes:**
- Wrapped AgentRow, KubexRow, ApprovalCard, ChatBubble, ServiceCard, StatusBadge, Sparkline, Pagination, and SearchInput with React.memo
- Confirmed useSearch, useSort, usePagination each use internal useMemo; added explanatory comments in AgentsPanel
- TrafficLog agentIds and filteredEntries now use useMemo with minimal dependency arrays
- Added useCallback audit comments in Dashboard confirming agentSeries.push/kubexSeries.push intentional omissions
- Verified existing pagination (20/page) limits DOM nodes; localStorage cap confirmed at 500 entries in AppContext
- Added "Clear" button to OrchestratorChat input area; clears messages to initial welcome message
- Verified ApprovalQueue and AgentDetailPage already lazy()-imported in App.tsx; added chunk size comment block
- Fixed localStorage Date rehydration bug: AppContext now rehydrates ISO string timestamps back to Date objects on load (both trafficLog and chatMessages)
- Created performance.spec.ts (12 tests: pagination limits DOM, localStorage cap at 500, rapid navigation stability, no ResizeObserver errors, page load under 3s, memo components render, Clear chat button)
- Build verified clean; 154/154 tests passed
**Tests:** 142 → 154

---

## Iteration 15: ContainersPanel — Search, Filter, Sort, and Pagination
**Commit:** `1067416`
**Files created:** `tests/e2e/containers.spec.ts`
**Files modified:** `src/components/ContainersPanel.tsx`
**Changes:**
- Upgraded ContainersPanel.tsx with useSearch (kubex_id, agent_id, image, status), useSort (kubex_id, agent_id, status), usePagination (10/page), and status filter dropdown (all / running / created / stopped / error)
- Added ARIA role="table" + role="columnheader" to containers table matching AgentsPanel pattern
- Added result count in header subtitle: "3 of 7 kubexes" when filtered
- Created containers.spec.ts (9 tests: header, refresh, search input, search filters, clear button, status filter, ARIA table role, sortable column headers, route-mocked data)
- Build verified; 163/163 tests passed
**Tests:** 154 → 163

---

## Iteration 16: Keyboard Shortcuts + Command Palette
**Commit:** `2bfa8b8`
**Files created:** `src/hooks/useKeyboardShortcuts.ts`, `src/components/CommandPalette.tsx`, `src/components/KeyboardShortcutsHelp.tsx`, `tests/e2e/command-palette.spec.ts`
**Files modified:** `src/components/Layout.tsx`
**Changes:**
- Created useKeyboardShortcuts hook with global keyboard shortcut registration, modifier key support, input-awareness, and cleanup on unmount
- Created CommandPalette component: VS Code-style Ctrl+K fuzzy command palette with ARIA combobox/listbox roles, category grouping, arrow-key navigation, and Enter-to-execute
- Created KeyboardShortcutsHelp modal overlay listing all shortcuts, triggered by `?` key
- Updated Layout.tsx to wire useKeyboardShortcuts, render CommandPalette and KeyboardShortcutsHelp, add "Search ⌘K" trigger button and "?" help button to top bar
- Implemented two-key navigation sequences: G+D (Dashboard), G+A (Agents), G+T (Traffic), G+C (Chat), G+K (Containers), G+P (Approvals)
- Escape closes whichever overlay is open (palette → help → kill-all dialog, in priority order)
- Created command-palette.spec.ts (21 tests)
- Build verified clean; 184/184 tests passed
**Tests:** 163 → 184

---

## Iteration 17: CSS Custom Properties for Theme Tokens
**Commit:** `daac77f`
**Files created:** *(none)*
**Files modified:** `src/index.css`, `tailwind.config.js`, all component files with hardcoded hex values
**Changes:**
- Defined CSS custom properties in index.css under `:root` for all recurring hex values
- Mapped all recurring hex values to semantic variable names (e.g., `--color-bg-primary`, `--color-accent`)
- Updated tailwind.config.js to reference CSS variables for the kubex color palette
- Replaced hardcoded hex values across ALL components with `var(--name)` references
- Build verified clean; 184/184 tests still passed (no behavioral changes)
**Tests:** 184 → 184

---

## Iteration 18: System Status Banner + Breadcrumb Navigation
**Commit:** `0dc4aa1`
**Files created:** `src/components/SystemStatusBanner.tsx`, `src/components/Breadcrumb.tsx`, `tests/e2e/system-status.spec.ts`
**Files modified:** `src/components/Dashboard.tsx`, `src/components/AgentDetailPage.tsx`, `src/components/Layout.tsx`
**Changes:**
- Created SystemStatusBanner component: aggregates all service health into "All Systems Operational" / "N services degraded" / "System Critical" banner with color coding; compact summary row showing total agent count, kubex count, and service ratio
- Created Breadcrumb component: semantic `<nav aria-label="Breadcrumb">`, aria-current="page" on last item, keyboard-accessible with focus-visible rings
- Updated Dashboard.tsx to render SystemStatusBanner above quick stats
- Updated AgentDetailPage.tsx to replace "← Back to Agents" button with Breadcrumb showing "Agents > agent-id"
- Updated Layout.tsx to import Breadcrumb; shows breadcrumb trail inline in top bar for nested routes (/agents/:agentId); non-nested routes keep existing icon + description format
- Created system-status.spec.ts (17 tests: banner renders, operational state, summary pills, role=status, aria-live=polite, loading state, page scope, breadcrumb renders, first item clickable, last item aria-current, breadcrumb navigates, top bar breadcrumb on nested routes)
- Build verified clean, 82 modules; 201/201 tests passed
**Tests:** 184 → 201

---

## Iteration 19: Responsive Collapsible Sidebar
**Commit:** `5736466`
**Files modified:** `src/components/Layout.tsx`, `tests/e2e/responsive.spec.ts`
**Changes:**
- Added useMediaQuery hook in Layout.tsx for ≥768px breakpoint detection
- Added mobileSidebarOpen state — hidden by default on mobile, auto-close on resize to ≥ md
- On `< 768px`: sidebar uses fixed positioning + translateX(-100%) when closed, translateX(0) when open
- On `≥ 768px`: sidebar stays in normal flex flow (md:relative md:translate-x-0)
- Smooth transition-transform duration-300 ease-in-out slide animation
- Hamburger button (data-testid="sidebar-hamburger", aria-expanded) in top bar — md:hidden
- Close button (data-testid="sidebar-close") inside sidebar brand bar — md:hidden
- Overlay backdrop (data-testid="sidebar-backdrop", bg-black/60 md:hidden) with tap-to-close
- Auto-close sidebar on route change (mobile)
- Auto-close sidebar on Escape key
- Hidden date and "/ description" text on narrow screens to prevent crowding
- Kill All label hidden on small screens
- Rewrote responsive.spec.ts to test new behavior: hidden-by-default on mobile, hamburger open/close, backdrop, aria-expanded, nav-after-toggle, mobile fills viewport; preserved all existing desktop tests
- Build verified clean, 82 modules; 212/212 tests passed
**Tests:** 201 → 212

---

## Iteration 20: Agent Detail Action Dispatch
**Commit:** `e5d2f24`
**Files created:** `tests/e2e/agent-dispatch.spec.ts`
**Files modified:** `src/components/AgentDetailPage.tsx`
**Changes:**
- Upgraded ActionsTab in AgentDetailPage with dispatch form: capability pre-filled from agent's capabilities list, message textarea, priority selector
- Added dispatch history for the current agent (filtered from AppContext trafficLog by agent_id)
- Wired to dispatchTask() in api.ts; adds traffic entry to AppContext on success and failure
- Added "Dispatch Task →" button on OverviewTab that navigates to Actions tab
- Created agent-dispatch.spec.ts (12 tests)
- Build verified clean, 82 modules; 224/224 tests passed
**Tests:** 212 → 224

---

## Iteration 21: Global Connection Health Indicator (Top Bar)
**Commit:** `0e86f7c`
**Files created:** `src/hooks/useHealthCheck.ts`, `src/components/ConnectionIndicator.tsx`, `tests/e2e/connection-indicator.spec.ts`
**Files modified:** `src/context/AppContext.tsx`, `src/components/Layout.tsx`, `src/components/Dashboard.tsx`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/integration.spec.ts`, `tests/e2e/responsive.spec.ts`
**Changes:**
- Added services: ServiceHealth[], setServices, and derived systemStatus: SystemStatus to AppContext
- Exported deriveSystemStatus() helper and INITIAL_SERVICES constant from AppContext
- Created useHealthCheck hook: runs health checks on 15s interval globally; writes results into AppContext.services; replaces per-component health logic
- Created ConnectionIndicator component: colored dot + short label in top bar; click/hover opens popover listing each service's status, response time, and aggregate label; closes on Escape / outside click
- Mounted useHealthCheck() in Layout.tsx so health runs on every page (not just Dashboard)
- Replaced static [role="status"] live badge in Layout.tsx top bar with ConnectionIndicator
- Refactored Dashboard.tsx to remove own services state and checkHealth callback; reads services from AppContext instead
- Fixed 4 pre-existing tests that targeted the old static badge
- Created connection-indicator.spec.ts (24 tests: presence on all 6 pages, healthy dot color, label text, aria-label, aria-haspopup, aria-expanded, popover open/close, Escape/outside-click dismiss, all 5 service rows, healthy status text, role=tooltip, degraded state simulation, navigation persistence)
- Build verified clean, 84 modules; 248/248 tests passed
**Tests:** 224 → 248

---

## Iteration 22: Dark/Light Theme Toggle
**Commit:** `aca8150`
**Files created:** `src/hooks/useTheme.ts`, `src/components/ThemeToggle.tsx`, `tests/e2e/theme-toggle.spec.ts`
**Files modified:** `src/index.css`, `src/components/Layout.tsx`
**Changes:**
- Added [data-theme="light"] CSS variable overrides in index.css for all 16 tokens
- Created useTheme hook: reads/writes kubex-theme localStorage key; applies data-theme attribute to `<html>`
- Created ThemeToggle component: sun/moon SVG icon button with aria-pressed, aria-label, data-testid attributes
- Mounted useTheme() in Layout.tsx so preference applies on every page from first render
- Added ThemeToggle to Layout.tsx top bar between "?" shortcuts button and separator
- Created theme-toggle.spec.ts (17 tests)
- Build verified clean, 86 modules; 265/265 tests passed
**Tests:** 248 → 265

---

## Iteration 23: Notification Center with History
**Commit:** `9b389c7`
**Files created:** `src/context/NotificationContext.tsx`, `src/components/NotificationCenter.tsx`, `tests/e2e/notification-center.spec.ts`
**Files modified:** `src/context/ToastContext.tsx`, `src/App.tsx`, `src/components/Layout.tsx`
**Changes:**
- Created NotificationContext: notification history state, unread count, addNotification, markAllRead, clearAll; capped at 100 entries
- Created NotificationCenter component: bell icon button with unread count badge, click opens dropdown with scrollable notification list, each item has type accent bar + timestamp + unread dot, "Mark all read" and "Clear all" actions, empty state, accessible ARIA
- Updated ToastContext to add optional onToastAdded side-effect prop so every toast is mirrored into notification history
- Updated App.tsx to add NotificationProvider to provider tree; added ToastBridge component that wires addNotification into ToastProvider.onToastAdded
- Updated Layout.tsx to mount NotificationCenter in top bar between ThemeToggle and separator
- Created notification-center.spec.ts (24 tests: bell presence, aria-label, aria-expanded, badge count, open/close, Escape/outside-click dismiss, empty state, toast mirroring, unread badge, mark-all-read, item read state, clear-all, all-pages presence, keyboard focus, Enter activation, aria-live log region)
- Build verified clean, 88 modules; 289/289 tests passed
**Tests:** 265 → 289

---

## Iteration 24: Settings and Preferences Page
**Commit:** `f03e1ba`
**Files created:** `src/hooks/useSettings.ts`, `src/components/SettingsPage.tsx`, `tests/e2e/settings.spec.ts`
**Files modified:** `src/App.tsx`, `src/components/Layout.tsx`
**Changes:**
- Created useSettings hook with SettingsProvider: persists pollingInterval, defaultPageSize, autoRefresh to localStorage under kubex-settings; merges stored values with defaults to handle schema additions
- Created SettingsPage component with four sections: Appearance (theme selector), Connection (token management, API endpoint display), Data (auto-refresh toggle, polling interval, page size, clear traffic/chat with confirmation), About (version/build info), Reset (restore defaults with confirmation)
- Added /settings route in App.tsx (lazy-loaded); wrapped provider tree with SettingsProvider
- Added "Settings ⚙" nav item to NAV_ITEMS in Layout.tsx
- Created settings.spec.ts (32 tests)
- Build verified clean, 90 modules, SettingsPage 3.03 KB gzipped; 321/321 tests passed
**Tests:** 289 → 321

---

## Iteration 25: Data Export (JSON/CSV)
**Commit:** `dd08a19`
**Files created:** `src/utils/export.ts`, `src/components/ExportMenu.tsx`, `tests/e2e/export.spec.ts`
**Files modified:** `src/components/TrafficLog.tsx`, `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `src/components/OrchestratorChat.tsx`
**Changes:**
- Created export.ts utility with exportAsJSON(data, filename) and exportAsCSV(rows, headers, rowMapper, filename); pure browser download via temporary anchor + URL.createObjectURL
- Created ExportMenu component: dropdown button with JSON / CSV options; closes on Escape and outside-click; aria-haspopup, aria-expanded, role="menu", role="menuitem" ARIA attributes
- Added ExportMenu to TrafficLog.tsx: exports filtered traffic as JSON or CSV; disabled when filtered list is empty
- Added ExportMenu to AgentsPanel.tsx: exports full agent list as JSON; disabled when list is empty
- Added ExportMenu to ContainersPanel.tsx: exports full kubex list as JSON; disabled when list is empty
- Added ExportMenu to OrchestratorChat.tsx: exports chat history as JSON; disabled when messages list is empty
- Created export.spec.ts (30 tests: menus present on all 4 pages; aria-haspopup/aria-expanded; disabled when empty; opens dropdown; JSON+CSV options on traffic; JSON-only on agents/containers/chat; role=menu/menuitem; Escape closes; outside-click closes; JSON download; CSV download)
- Build verified clean, 92 modules; 351/351 tests passed
**Tests:** 321 → 351

---

## Iteration 26: Dashboard Activity Feed
**Commit:** `f6891e1`
**Files created:** `src/components/ActivityFeed.tsx`, `tests/e2e/activity-feed.spec.ts`
**Files modified:** `src/components/Dashboard.tsx`, `tests/e2e/dashboard.spec.ts`
**Changes:**
- Created ActivityFeed component: compact list of last 10 traffic entries; timestamp, agent, action, status badge, color-coded left border accent; data-testid attributes; empty state when no events
- Added ActivityFeed to Dashboard.tsx after the agent overview section; reads trafficLog from AppContext; "View all →" button calls onNavigate('traffic')
- Fixed dashboard.spec.ts "View all →" test: scoped to Registered Agents section to avoid strict-mode violation with new Activity Feed "View all →"
- Created activity-feed.spec.ts (12 tests: section renders, heading, empty state, rows from localStorage, row content, 10-row cap, subtitle count, denied/escalated border accents, view-all button, view-all navigates to Traffic, aria-label on list)
- Build verified clean, 93 modules; 363/363 tests passed
**Tests:** 351 → 363
