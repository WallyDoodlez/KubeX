# Command Center Improvement Tracker

> **Loop protocol:** Check for `[~]` (resume) before `[ ]` (start next). Mark `[x]` only after build + tests pass.

---

- [x] **Iteration 35: Collapsible Dashboard Sections**
  - [x] Create `src/hooks/useCollapsible.ts` — manages collapse state for named sections, persisted in localStorage under a caller-supplied key; `isCollapsed(id)` returns current state, `toggle(id)` flips it, `setCollapsed(id, bool)` sets explicitly
  - [x] Create `src/components/CollapsibleSection.tsx` — section wrapper with clickable header button (`aria-expanded`, `aria-controls`, `data-testid`); chevron indicator rotates -90° when collapsed; smooth height transition via `scrollHeight` measurement and `height` CSS transition; `subtitle` and `action` only shown when expanded; `role="region"` + `aria-labelledby` on content panel for accessibility
  - [x] Wire into `Dashboard.tsx` — wrap Service Health, Registered Agents, and Activity Feed sections in `CollapsibleSection`; state persisted in localStorage under `kubex-dashboard-sections`; pass `hideHeader` to `ActivityFeed` to suppress its internal header when wrapped
  - [x] Update `ActivityFeed.tsx` — add optional `hideHeader` prop to suppress built-in section header when section is owned by `CollapsibleSection`
  - [x] Create `tests/e2e/collapsible-sections.spec.ts` (22 tests) — section presence, toggle button visibility, default expanded state with `aria-expanded=true`, section titles visible, collapse interaction sets `aria-expanded=false`, toggle idempotency, localStorage persistence after collapse, expanded state leaves storage clean, persistence across page reload, multiple sections collapse independently, `aria-controls` points to panel id, panel has `role=region` + `aria-labelledby`
  - [x] Update `tests/e2e/activity-feed.spec.ts` — fix 4 tests that referenced the ActivityFeed header which now lives in the CollapsibleSection: heading selector, subtitle selector, "View all →" button selector and navigation test
  - [x] Build: npm run build — clean (107 modules)
  - [x] Test: npx playwright test — 529/529 passed
  - [x] Update `docs/CHANGELOG.md`

---

- [x] **Iteration 34: Task History Page**
  - [x] Create `src/components/TaskHistoryPage.tsx` — dedicated table view of dispatched tasks extracted from traffic log entries where `action === 'dispatch_task'`; columns: task_id, agent_id, capability, status, dispatched_at; expandable rows show full result/error details; uses `useSearch`, `useSort`, `usePagination`, `useQueryParams`; status filter (all/pending/allowed/denied/escalated); search across task_id, agent_id, capability; sort by dispatched_at, agent_id, status; expandable detail row with JSON pretty-print of entry details
  - [x] Add `Tasks` nav item with `✦` icon to `NAV_ITEMS` in `Layout.tsx`; add `G+h` keyboard shortcut for go-to-tasks
  - [x] Add `/tasks` route to `App.tsx` (lazy-loaded); add `TasksPage` wrapper that pulls `trafficLog` from `AppContext`
  - [x] Add "Go to Task History" entry to `CommandPalette.tsx` built-in nav commands
  - [x] Create `tests/e2e/task-history.spec.ts` (14 tests) — page loads, nav item visible, sidebar highlights active, Task History heading, empty state when no dispatch_task entries, empty state description, navigation from sidebar, app shell intact, direct URL, status filter buttons, search input, export menu, All filter active by default, command palette entry
  - [x] Build: npm run build — clean (105 modules)
  - [x] Test: npx playwright test — 507/507 passed
  - [x] Update `docs/CHANGELOG.md`

---

- [x] **Iteration 1: Test Infrastructure + React Router**
  - [x] Install dependencies (react-router-dom, vitest, @testing-library/react, @playwright/test, msw)
  - [x] Configure Vitest in vite.config.ts
  - [x] Create playwright.config.ts
  - [x] Create src/context/AppContext.tsx (shared state context)
  - [x] Refactor src/App.tsx — replace hidden divs with BrowserRouter + Routes + React.lazy + Suspense
  - [x] Refactor src/components/Layout.tsx — useNavigate/useLocation instead of state callback
  - [x] Create tests/e2e/mocks/handlers.ts (MSW mock API handlers)
  - [x] Create tests/e2e/smoke.spec.ts (4 tests: load, nav, routes, direct URL)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 2: Custom Hooks + Interval Cleanup + Error Boundaries**
  - [x] Create src/hooks/usePolling.ts (cleanup on unmount, exponential backoff, pause on tab hidden)
  - [x] Create src/hooks/useApiCall.ts (one-shot API call with loading/error)
  - [x] Create src/components/ErrorBoundary.tsx (catch render errors, retry UI)
  - [x] Refactor Dashboard.tsx — replace setInterval with usePolling
  - [x] Refactor AgentsPanel.tsx — replace setInterval with usePolling
  - [x] Refactor ContainersPanel.tsx — replace setInterval with usePolling
  - [x] Refactor OrchestratorChat.tsx — fix memory leak (uncleared setInterval in handleSend), use usePolling
  - [x] Wrap routes in ErrorBoundary (App.tsx)
  - [x] Create tests/e2e/error-recovery.spec.ts (3 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 3: API Hardening + Auth + Input Validation**
  - [x] Harden src/api.ts — remove changeme token default, add request dedup, 401/403 detection
  - [x] Create src/context/AuthContext.tsx (manager token state)
  - [x] Create src/components/AuthGate.tsx (token input when env var missing)
  - [x] Create src/components/ConfirmDialog.tsx (accessible modal, replace window.confirm)
  - [x] Create src/utils/validation.ts (validateCapability, validateMessage)
  - [x] Add validation to OrchestratorChat.tsx (inline errors, disable send on invalid)
  - [x] Replace window.confirm in AgentsPanel.tsx and ContainersPanel.tsx with ConfirmDialog
  - [x] Create tests/e2e/auth.spec.ts + tests/e2e/validation.spec.ts (6 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 4: Dashboard Enhancement**
  - [x] Create src/hooks/useTimeSeries.ts (accumulate data points for sparklines)
  - [x] Create src/components/Sparkline.tsx (SVG polyline, no chart library)
  - [x] Upgrade Dashboard.tsx — sparklines, clickable stat cards, "Last updated Xs ago", "+N more" link
  - [x] Upgrade ServiceCard.tsx — response time sparkline history
  - [x] Create tests/e2e/dashboard.spec.ts (6 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 5: AgentsPanel — Search, Filter, Pagination**
  - [x] Create src/hooks/usePagination.ts
  - [x] Create src/hooks/useSearch.ts
  - [x] Create src/hooks/useSort.ts
  - [x] Create src/components/SearchInput.tsx (debounced, clear button)
  - [x] Create src/components/Pagination.tsx (prev/next, page indicator, page size)
  - [x] Upgrade AgentsPanel.tsx — integrate search, sort, pagination, ARIA table roles
  - [x] Create tests/e2e/agents.spec.ts (8 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 6: Traffic Log Upgrade + Persistence**
  - [x] Create src/hooks/useLocalStorage.ts
  - [x] Update src/context/AppContext.tsx — persist trafficLog + chatMessages to localStorage
  - [x] Create src/components/TrafficFilterBar.tsx (status, agent, time range, search)
  - [x] Upgrade TrafficLog.tsx — filter bar, pagination, clear log, entry count
  - [x] Add TrafficFilter type to types.ts
  - [x] Create tests/e2e/traffic.spec.ts (7 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 7: Agent Detail View (New Page)**
  - [x] Create src/components/Tabs.tsx (reusable, keyboard nav, role=tablist)
  - [x] Create src/components/AgentDetailPage.tsx (Overview, Actions, Config tabs)
  - [x] Add route /agents/:agentId in App.tsx
  - [x] Make AgentsPanel.tsx rows clickable → navigate to detail
  - [x] Update types.ts (NavPage, AgentDetail interface)
  - [x] Create tests/e2e/agent-detail.spec.ts (7 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 8: SSE Live Streaming + Terminal Renderer + HITL**
  - [x] PRE-CHECK: git pull and verify GET /tasks/{id}/stream endpoint exists in Gateway code. If not available, mark this iteration BLOCKED and skip to iteration 9
  - [x] Create src/hooks/useSSE.ts (EventSource lifecycle, reconnect, final handling)
  - [x] Create src/components/TerminalOutput.tsx (monospace stdout/stderr renderer, auto-scroll)
  - [x] Create src/components/HITLPrompt.tsx (awaiting_input prompt card, submit via POST /actions)
  - [x] Upgrade OrchestratorChat.tsx — switch from polling to SSE, embed TerminalOutput + HITLPrompt
  - [x] Add "Live Output" tab to AgentDetailPage.tsx
  - [x] Add SSEChunk, HITLRequest types to types.ts + new agent states (booting, credential_wait, ready)
  - [x] Update StatusBadge.tsx — colors for new lifecycle states
  - [x] Add getTaskStream(), provideInput() to api.ts
  - [x] Create tests/e2e/streaming.spec.ts (8 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 9: Approval Queue (New Page)**
  - [x] Create src/components/ApprovalQueue.tsx (card list, approve/reject, time ticker)
  - [x] Add getEscalations(), resolveEscalation() to api.ts
  - [x] Add "Approvals" nav item with count badge to Layout.tsx
  - [x] Add route /approvals in App.tsx
  - [x] Add pendingApprovalCount to AppContext.tsx
  - [x] Add ApprovalRequest, ApprovalDecision types to types.ts
  - [x] Create tests/e2e/approvals.spec.ts (7 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 10: Emergency Controls (Top Bar)**
  - [x] Create src/components/KillAllDialog.tsx (typed "KILL ALL" confirmation)
  - [x] Create src/components/QuickActionsMenu.tsx (dropdown with kubex list)
  - [x] Create src/components/Toast.tsx (auto-dismiss notifications)
  - [x] Create src/context/ToastContext.tsx (toast state management)
  - [x] Add killAllKubexes(), pauseKubex(), resumeKubex() to api.ts
  - [x] Add emergency controls to Layout.tsx top bar
  - [x] Create tests/e2e/controls.spec.ts (8 tests)
  - [x] Verify: npm run build clean + npx playwright test passes
  - [x] Commit

- [x] **Iteration 11: Polish + Accessibility Audit**
  - [x] Create src/components/SkeletonLoader.tsx (reusable SkeletonTable, SkeletonCard, SkeletonText)
  - [x] Create src/components/EmptyState.tsx (reusable empty state)
  - [x] Upgrade Layout.tsx — skip-to-content, aria-current, responsive sidebar, landmark roles
  - [x] Audit all components — focus-visible rings, ARIA labels, semantic HTML
  - [x] Update index.css — focus-visible utilities, print stylesheet
  - [x] Create tests/e2e/accessibility.spec.ts (Playwright-native: landmarks, tab order, aria-current, focus)
  - [x] Create tests/e2e/responsive.spec.ts (sidebar breakpoints at 375/768/1280/1920px)
  - [x] Create tests/e2e/integration.spec.ts (full user flow: dispatch → stream → HITL → traffic → persist)
  - [x] Verify: npm run build clean + npx playwright test ALL green (120/120 passed)
  - [x] Commit

---

- [x] **Iteration 12: Wire AuthGate into App tree + replace polling with SSE in OrchestratorChat**
  - [x] Wrap App.tsx route tree with `<AuthGate>` so unauthenticated users see the token prompt before any route renders (AuthGate was built in iteration 3 but never placed in the component tree — it is currently dead code)
  - [x] Remove the manual `setInterval` polling loop from OrchestratorChat.tsx (`pollIntervalRef`, `POLL_INTERVAL`, `POLL_MAX` constants, and the `setInterval` block inside `handleSend`)
  - [x] Replace polling with `useSSE` hook: after `dispatchTask` succeeds, pass the task stream URL (`/tasks/{taskId}/stream`) to `useSSE`; map incoming SSE chunk types (`stdout`, `stderr`, `result`, `failed`, `cancelled`, `hitl_request`) to the appropriate `addMessage` calls and traffic entries
  - [x] Embed `<TerminalOutput>` inside the result bubble when a stream is active so live stdout/stderr chunks render incrementally rather than as a single final blob
  - [x] Embed `<HITLPrompt>` inside OrchestratorChat when the stream emits a `hitl_request` chunk (the component was created in iteration 8 but OrchestratorChat never wired it)
  - [x] Update the `sending` spinner text to reflect SSE states: "Connecting…" / "Streaming…" / "Waiting for result…" based on `useSSE` status
  - [x] Add `getTaskStream()` URL builder to api.ts if not already returning a full URL suitable for `EventSource` (currently only added to api.ts signature, confirm it returns the bare URL string)
  - [x] Create tests/e2e/authgate.spec.ts — (a) no token → AuthGate renders before any nav link; (b) valid token entered → app tree becomes visible; (c) env token set → AuthGate is bypassed
  - [x] Extend tests/e2e/streaming.spec.ts — add test that OrchestratorChat no longer issues repeated GET /tasks/{id} poll requests after dispatch (assert XHR log has ≤1 task result fetch)
  - [x] Verify: npm run build clean + npx playwright test passes (128/128)
  - [x] Commit

- [x] **Iteration 13: Replace ad-hoc loading/empty states with SkeletonLoader + EmptyState**
  - [x] **AgentsPanel.tsx** — replace the inline `[1,2,3].map(i => <div animate-pulse>)` skeleton with `<SkeletonTable rows={3} cols={5} />`; replace the local `EmptyState` function component with the shared `<EmptyState icon="◎" title="No agents registered" description="Run docker compose up to start agents." />`
  - [x] **ContainersPanel.tsx** — replace the inline `[1,2,3].map(i => <div animate-pulse>)` skeleton with `<SkeletonTable rows={3} cols={5} />`; replace the local `EmptyContainers` function component with the shared `<EmptyState icon="⬡" title="No kubexes found" description="Kubexes appear here when spawned via Manager." />`
  - [x] **AgentDetailPage.tsx** — replace the bespoke two-div loading shimmer (lines 47–52) with `<SkeletonCard />` followed by `<SkeletonText lines={4} />`; replace the ad-hoc error/not-found block with `<EmptyState icon="⚠" title="Agent not found" description={error} action={{ label: '← Back to Agents', onClick: () => navigate('/agents') }} />`
  - [x] **Dashboard.tsx** — replace the inline `<span className="animate-pulse">Loading agents…</span>` block with `<SkeletonCard />` cards matching the agent card grid layout; replace the local `EmptyState` function at the bottom of the file with the shared component
  - [x] **ApprovalQueue.tsx** — replace the hardcoded empty-state `<div>` (lines 49–56) with `<EmptyState icon="✓" title="No pending approvals" description="Escalated actions from the policy engine will appear here." />`; add loading state using `<SkeletonCard />` (2 cards) while initial data resolves
  - [x] Delete all local `EmptyState`/`EmptyContainers` function declarations that were copy-pasted into individual component files — they are now superseded by the shared component
  - [x] Create tests/e2e/skeletons.spec.ts — intercept API routes with a delayed handler; assert `aria-busy="true"` skeleton elements appear during load; assert they disappear and real content renders after the response resolves
  - [x] Verify: npm run build clean + npx playwright test passes (142/142)
  - [x] Commit

- [x] **Iteration 15: ContainersPanel — Search, Filter, Sort, and Pagination**
  - [x] Upgrade ContainersPanel.tsx — integrate `useSearch` (kubex_id, agent_id, image, status), `useSort` (kubex_id, agent_id, status), `usePagination` (10/page), and a status filter dropdown (all / running / created / stopped / error)
  - [x] Add ARIA `role="table"` + `role="columnheader"` to the containers table (matching AgentsPanel pattern)
  - [x] Show result count in header subtitle: "3 of 7 kubexes" when filtered
  - [x] Create tests/e2e/containers.spec.ts (9 tests: header, refresh, search input, search filters, clear button, status filter, ARIA table role, column headers sortable, route-mocked data tests)
  - [x] Verify: npm run build + npx playwright test passes (163/163)

- [x] **Iteration 16: Keyboard Shortcuts + Command Palette**
  - [x] Create `src/hooks/useKeyboardShortcuts.ts` — global keyboard shortcut registration with modifier key support, input-awareness, and cleanup on unmount
  - [x] Create `src/components/CommandPalette.tsx` — VS Code-style Ctrl+K fuzzy command palette with ARIA combobox/listbox roles, category grouping, arrow-key navigation, and Enter-to-execute
  - [x] Create `src/components/KeyboardShortcutsHelp.tsx` — modal overlay listing all shortcuts, triggered by `?` key
  - [x] Update `src/components/Layout.tsx` — wire `useKeyboardShortcuts`, render `<CommandPalette>` and `<KeyboardShortcutsHelp>`, add "Search ⌘K" trigger button and "?" help button to top bar
  - [x] Two-key navigation sequences: G+D (Dashboard), G+A (Agents), G+T (Traffic), G+C (Chat), G+K (Containers), G+P (Approvals)
  - [x] Escape closes whichever overlay is open (palette → help → kill-all dialog, in priority order)
  - [x] Create `tests/e2e/command-palette.spec.ts` (21 tests)
  - [x] Verify: npm run build clean + npx playwright test passes (184/184)
  - [x] Commit

- [x] **Iteration 17: CSS custom properties for theme tokens**
  - [x] Define CSS custom properties in index.css under `:root`
  - [x] Map all recurring hex values to semantic variable names
  - [x] Update tailwind.config.js to reference CSS variables for kubex color palette
  - [x] Replace hardcoded hex values across ALL components with `var(--name)` references
  - [x] Build: npm run build
  - [x] Test: npx playwright test — 184/184 passed

- [x] **Iteration 18: System Status Banner + Breadcrumb Navigation**
  - [x] Create `src/components/SystemStatusBanner.tsx` — aggregate all service health into a top-level "All Systems Operational" / "N services degraded" / "System Critical" banner with color coding; compact summary row showing total agent count, kubex count, service ratio
  - [x] Create `src/components/Breadcrumb.tsx` — reusable breadcrumb nav component with semantic `<nav aria-label="Breadcrumb">`, `aria-current="page"` on last item, keyboard-accessible with focus-visible rings
  - [x] Update `Dashboard.tsx` — render `<SystemStatusBanner>` above quick stats
  - [x] Update `AgentDetailPage.tsx` — replace "← Back to Agents" button with `<Breadcrumb>` showing "Agents > agent-id"
  - [x] Update `Layout.tsx` — import `Breadcrumb`; show breadcrumb trail inline in the top bar for nested routes (`/agents/:agentId`); non-nested routes keep existing icon + description format
  - [x] Create `tests/e2e/system-status.spec.ts` (17 tests: banner renders, operational state, summary pills for agents/kubexes/services, role=status, aria-live=polite, loading state, not shown on other pages, breadcrumb renders, first item clickable, last item aria-current, breadcrumb navigates, top bar breadcrumb on nested routes, not visible on flat routes)
  - [x] Build: npm run build — clean (82 modules, no errors)
  - [x] Test: npx playwright test — 201/201 passed

- [x] **Iteration 19: Responsive collapsible sidebar**
  - [x] Add `useMediaQuery` hook in Layout.tsx (detects ≥ 768 px breakpoint)
  - [x] Add `mobileSidebarOpen` state — hidden by default on mobile, auto-close on resize to ≥ md
  - [x] On `< 768 px`: sidebar uses `fixed` positioning + `translateX(-100%)` when closed, `translateX(0)` when open
  - [x] On `≥ 768 px`: sidebar stays in normal flex flow (`md:relative md:translate-x-0`)
  - [x] Smooth `transition-transform duration-300 ease-in-out` slide animation
  - [x] Hamburger button (`data-testid="sidebar-hamburger"`, `aria-expanded`) in top bar — `md:hidden`
  - [x] Close button (`data-testid="sidebar-close"`) inside sidebar brand bar — `md:hidden`
  - [x] Overlay backdrop (`data-testid="sidebar-backdrop"`, `bg-black/60 md:hidden`) — tap-to-close
  - [x] Auto-close sidebar on route change (mobile)
  - [x] Auto-close sidebar on Escape key
  - [x] Hide date and "/ description" text on narrow screens to prevent crowding
  - [x] Kill All label hidden on small screens (`<span className="hidden sm:inline">Kill All</span>`)
  - [x] Update `tests/e2e/responsive.spec.ts` — rewritten to test new behaviour: hidden-by-default on mobile, hamburger open/close, backdrop, aria-expanded, nav-after-toggle, mobile fills viewport, all existing desktop tests preserved
  - [x] Build: npm run build — clean (82 modules, no errors)
  - [x] Test: npx playwright test — 212/212 passed
  - [x] Commit

- [x] **Iteration 20: Agent detail action dispatch**
  - [x] Upgrade ActionsTab in AgentDetailPage — dispatch form with capability pre-filled from agent's capabilities, message textarea, priority selector
  - [x] Show dispatch history for this agent (filtered from AppContext trafficLog by agent_id)
  - [x] Wire to dispatchTask() in api.ts, add traffic entry to AppContext on success/failure
  - [x] Add "Dispatch Task →" button on OverviewTab that navigates to Actions tab
  - [x] Create tests/e2e/agent-dispatch.spec.ts (12 tests)
  - [x] Build: npm run build — clean (82 modules, no errors)
  - [x] Test: npx playwright test — 224/224 passed
  - [x] Commit

- [x] **Iteration 22: Dark/Light Theme Toggle**
  - [x] Add `[data-theme="light"]` CSS variable overrides in `index.css` (all 16 tokens)
  - [x] Create `src/hooks/useTheme.ts` — reads/writes `kubex-theme` localStorage key; applies `data-theme` attr to `<html>`
  - [x] Create `src/components/ThemeToggle.tsx` — sun/moon SVG icon button, `aria-pressed`, `aria-label`, `data-testid`
  - [x] Mount `useTheme()` in `Layout.tsx` so preference applies on every page from first render
  - [x] Add `<ThemeToggle>` to `Layout.tsx` top bar (between `?` shortcuts button and separator)
  - [x] Create `tests/e2e/theme-toggle.spec.ts` (17 tests)
  - [x] Build: npm run build — clean (86 modules, no errors)
  - [x] Test: npx playwright test — 265/265 passed

- [x] **Iteration 21: Global Connection Health Indicator (Top Bar)**
  - [x] Add `services: ServiceHealth[]`, `setServices`, and derived `systemStatus: SystemStatus` to `AppContext`
  - [x] Export `deriveSystemStatus()` helper and `INITIAL_SERVICES` constant from `AppContext`
  - [x] Create `src/hooks/useHealthCheck.ts` — runs health checks on a 15 s interval globally; writes results into `AppContext.services`; replaces per-component health logic
  - [x] Create `src/components/ConnectionIndicator.tsx` — colored dot + short label in top bar; click/hover opens popover listing each service's status, response time, and aggregate label; closes on Escape / outside click
  - [x] Mount `useHealthCheck()` in `Layout.tsx` so health runs on every page (not just Dashboard)
  - [x] Replace static `[role="status"] live` badge in `Layout.tsx` top bar with `<ConnectionIndicator />`
  - [x] Refactor `Dashboard.tsx` — remove own `services` state and `checkHealth` callback; read `services` from `AppContext` instead; no longer calls `getGatewayHealth` / `getRegistryHealth` / `getManagerHealth` / `getBrokerHealth` directly
  - [x] Fix 4 pre-existing tests that targeted the old static badge (accessibility, integration, responsive)
  - [x] Create `tests/e2e/connection-indicator.spec.ts` (24 tests: presence on all 6 pages, healthy dot color, label text, aria-label, aria-haspopup, aria-expanded, popover open/close, Escape/outside-click dismiss, all 5 service rows, healthy status text, role=tooltip, aria-label list, refresh hint, degraded state simulation, navigation persistence)
  - [x] Build: npm run build — clean (84 modules, no errors)
  - [x] Test: npx playwright test — 248/248 passed
  - [x] Commit

- [x] **Iteration 23: Notification Center with history**
  - [x] Create `src/context/NotificationContext.tsx` — notification history state, unread count, `addNotification`, `markAllRead`, `clearAll`; capped at 100 entries
  - [x] Create `src/components/NotificationCenter.tsx` — bell icon button with unread count badge, click opens dropdown with scrollable notification list, each item has type accent bar + timestamp + unread dot, "Mark all read" and "Clear all" actions, empty state, accessible ARIA
  - [x] Update `src/context/ToastContext.tsx` — add optional `onToastAdded` side-effect prop so every toast is mirrored into notification history
  - [x] Update `src/App.tsx` — add `NotificationProvider` to provider tree; add `ToastBridge` component that wires `addNotification` into `ToastProvider.onToastAdded`
  - [x] Update `src/components/Layout.tsx` — import and mount `<NotificationCenter>` in top bar between ThemeToggle and separator
  - [x] Create `tests/e2e/notification-center.spec.ts` (24 tests: bell presence, aria-label, aria-expanded, badge count, open/close, Escape/outside-click dismiss, empty state, toast mirroring, unread badge, mark-all-read, item read state, clear-all, all-pages presence, keyboard focus, Enter activation, aria-live log region)
  - [x] Build: npm run build — clean (88 modules, no errors)
  - [x] Test: npx playwright test — 289/289 passed

- [x] **Iteration 24: Settings and Preferences page**
  - [x] Create `src/hooks/useSettings.ts` — `SettingsProvider` + `useSettings` hook; persists `pollingInterval`, `defaultPageSize`, `autoRefresh` to localStorage under `kubex-settings`; merges stored values with defaults to handle schema additions
  - [x] Create `src/components/SettingsPage.tsx` — four sections: Appearance (theme selector), Connection (token management, API endpoint display), Data (auto-refresh toggle, polling interval, page size, clear traffic/chat with confirmation), About (version/build info), Reset (restore defaults with confirmation)
  - [x] Add `/settings` route in `App.tsx` (lazy-loaded); wrap provider tree with `<SettingsProvider>`
  - [x] Add "Settings ⚙" nav item to `NAV_ITEMS` in `Layout.tsx`
  - [x] Create `tests/e2e/settings.spec.ts` (32 tests)
  - [x] Build: npm run build — clean, 90 modules, SettingsPage 3.03 KB gzipped
  - [x] Test: npx playwright test — 321/321 passed

- [x] **Iteration 25: Data export (JSON/CSV)**
  - [x] Create `src/utils/export.ts` — `exportAsJSON(data, filename)` and `exportAsCSV(rows, headers, rowMapper, filename)`; pure browser download via temporary anchor + `URL.createObjectURL`
  - [x] Create `src/components/ExportMenu.tsx` — dropdown button with JSON / CSV options; closes on Escape and outside-click; `aria-haspopup`, `aria-expanded`, `role="menu"`, `role="menuitem"` ARIA attributes
  - [x] Add `<ExportMenu>` to `TrafficLog.tsx` — exports filtered traffic as JSON or CSV; disabled when filtered list is empty
  - [x] Add `<ExportMenu>` to `AgentsPanel.tsx` — exports full agent list as JSON; disabled when list is empty
  - [x] Add `<ExportMenu>` to `ContainersPanel.tsx` — exports full kubex list as JSON; disabled when list is empty
  - [x] Add `<ExportMenu>` to `OrchestratorChat.tsx` — exports chat history as JSON; disabled when messages list is empty
  - [x] Create `tests/e2e/export.spec.ts` (30 tests: menus present on all 4 pages; aria-haspopup/aria-expanded; disabled when empty; opens dropdown; JSON+CSV options on traffic; JSON-only on agents/containers/chat; role=menu/menuitem; Escape closes; outside-click closes; JSON download; CSV download)
  - [x] Build: npm run build — clean, 92 modules
  - [x] Test: npx playwright test — 351/351 passed

- [x] **Iteration 26: Dashboard activity feed**
  - [x] Create `src/components/ActivityFeed.tsx` — compact list of last 10 traffic entries; timestamp, agent, action, status badge, color-coded left border accent; `data-testid` attributes for testing; empty state when no events
  - [x] Add `<ActivityFeed>` to `Dashboard.tsx` after the agent overview section; reads `trafficLog` from `AppContext`; "View all →" button calls `onNavigate('traffic')`
  - [x] Create `tests/e2e/activity-feed.spec.ts` (12 tests: section renders, heading, empty state, rows from localStorage, row content, 10-row cap, subtitle count, denied/escalated border accents, view-all button, view-all navigates to Traffic, aria-label on list)
  - [x] Fix `tests/e2e/dashboard.spec.ts` "View all →" test — scoped to Registered Agents section to avoid strict-mode violation with new Activity Feed "View all →"
  - [x] Build: npm run build — clean, 93 modules
  - [x] Test: npx playwright test — 363/363 passed

- [x] **Iteration 27: 404 catch-all route + favicon + PWA manifest**
  - [x] Create `src/components/NotFoundPage.tsx` — "Page not found" with 404 glyph, description, "← Back to Dashboard" button; matches dark theme via CSS custom properties
  - [x] Add catch-all `<Route path="*" element={<LazyNotFoundPage />} />` in `App.tsx`
  - [x] Create `public/favicon.svg` — KubexClaw "K" logo in emerald/cyan gradient on dark rounded-square background
  - [x] Update `index.html` — `/favicon.svg` link, `apple-touch-icon`, `/manifest.json` link, `theme-color` meta, `description` meta, `color-scheme` meta, Open Graph tags
  - [x] Create `public/manifest.json` — PWA manifest with name, short_name, description, start_url, display=standalone, background_color, theme_color, icons
  - [x] Create `tests/e2e/not-found.spec.ts` (19 tests)
  - [x] Build: npm run build — clean, 94 modules
  - [x] Test: npx playwright test — 382/382 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 28: Unified relative timestamps**
  - [x] Create `src/components/RelativeTime.tsx` — shows "just now", "30s ago", "5m ago", "2h ago", "1d ago" with a `title` tooltip showing the full ISO date; auto-updates every 30s via a shared interval
  - [x] Replace timestamp rendering in `TrafficLog.tsx` rows — use `<RelativeTime>` instead of `toLocaleTimeString`
  - [x] Replace timestamp rendering in `ActivityFeed.tsx` rows — use `<RelativeTime>` instead of local `formatTime` function
  - [x] Replace timestamp rendering in `OrchestratorChat.tsx` chat bubbles — use `<RelativeTime>` instead of `toLocaleTimeString`
  - [x] Replace timestamp rendering in `ApprovalQueue.tsx` cards — use `<RelativeTime>` for pending-for timers; remove unused 10 s tick interval
  - [x] Create `tests/e2e/relative-time.spec.ts` (15 tests)
  - [x] Build: npm run build — clean, 95 modules
  - [x] Test: npx playwright test — 397/397 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 33: Batch Operations for Agents and Kubexes**
  - [x] Add Iteration 33 entry in IMPROVEMENTS.md
  - [x] Create `src/hooks/useSelection.ts` — manages selected IDs set with toggleOne, toggleAll, clearSelection, isSelected, selectedCount, allSelected
  - [x] Create `src/components/SelectionBar.tsx` — floating action bar showing "N selected" with bulk action buttons; appears when items are selected; dismiss/clear button
  - [x] Update `AgentsPanel.tsx` — add checkbox column to table header and rows; wire useSelection; add SelectionBar with "Deregister Selected" bulk action using Promise.allSettled
  - [x] Update `ContainersPanel.tsx` — add checkbox column; wire useSelection; add SelectionBar with "Kill Selected" and "Start Selected" bulk actions using Promise.allSettled
  - [x] Create `tests/e2e/batch-operations.spec.ts` (25 tests)
  - [x] Update `docs/CHANGELOG.md`
  - [x] Build: npm run build — clean, 104 modules
  - [x] Test: npx playwright test — 493/493 passed
  - [x] Mark [x], commit

- [x] **Iteration 32: OAuth Authentication Scaffolding**
  - [x] Create `src/services/auth.ts` — OAuth service layer: `login()` (PKCE redirect), `handleCallback()` (code exchange), `refreshToken()`, `logout()`, `getAccessToken()`, `isAuthenticated()`, `getUser()`, `isOAuthConfigured()`; all URLs configurable via `VITE_OAUTH_AUTHORITY`, `VITE_OAUTH_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URI`; falls back to legacy bearer token when OAuth env vars are not set
  - [x] Update `src/context/AuthContext.tsx` — integrate OAuth service; add `oauthEnabled`, `isAuthenticated`, `user`, `login()`, `logout()` to context; backward-compatible: all existing consumers (`token`, `setToken`, `isConfigured`, `clearToken`) continue to work unchanged
  - [x] Create `src/components/LoginPage.tsx` — full-screen sign-in page with "Sign in with OAuth" button; shown only when `oauthEnabled=true` and user is not authenticated
  - [x] Create `src/components/UserMenu.tsx` — top-bar avatar + name dropdown with logout; displays OAuth user profile (name, email, avatar) or "API Token" label in legacy mode; closes on Escape and outside click
  - [x] Create `src/components/AuthCallbackPage.tsx` — handles OAuth redirect; exchanges code for tokens via `handleCallback()`; shows loading spinner during exchange and error state on failure; redirects to `/` on success
  - [x] Update `src/App.tsx` — add `OAuthGate` wrapper (shows LoginPage when OAuth configured + not authenticated; handles callback route); add `/auth/callback` route; lazy-load both new pages
  - [x] Update `src/components/Layout.tsx` — add `<UserMenu />` to top bar between NotificationCenter and the divider
  - [x] Update `src/api.ts` — `managerHeaders()` calls `getAccessToken()` (prefers OAuth token, falls back to static `VITE_MANAGER_TOKEN`)
  - [x] Update `docs/FE-BE-REQUESTS.md` — add OAuth endpoints section (entries 21–24): `/authorize`, `/token`, `/userinfo`, `/logout`; note JWT validation requirements for Manager/Gateway
  - [x] Create `tests/e2e/oauth.spec.ts` (16 tests) — legacy mode compatibility, login page visibility, callback route registration, UserMenu accessibility, PKCE storage, OAuthGate pass-through
  - [x] Build: npm run build — clean
  - [x] Test: npx playwright test — 468/468 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 31: URL query params for shareable filters**
  - [x] Create `src/hooks/useQueryParams.ts` — typed wrapper around React Router's `useSearchParams`; reads initial values from URL on mount; omits params that equal their defaults to keep URLs clean; `push=true` for discrete filter changes (navigable back/forward), `push=false` for incremental keystrokes (replaceState)
  - [x] Update `src/hooks/useSearch.ts` — add optional `initialQuery` param to seed search state from URL on mount
  - [x] Update `src/hooks/useSort.ts` — accept optional `initialSortConfig` param to restore sort state from URL on mount
  - [x] Wire `useQueryParams` into `AgentsPanel.tsx` — search, sort key+direction, page persisted in URL; handlers update URL on user action; initial values restored on direct navigation or page refresh
  - [x] Wire `useQueryParams` into `ContainersPanel.tsx` — search, status filter, sort key+direction, page persisted in URL; status filter uses pushState (discrete); search uses replaceState (incremental)
  - [x] Wire `useQueryParams` into `TrafficLog.tsx` — status filter, agent filter, search, page persisted in URL; discrete filter changes push history; search keystrokes replace
  - [x] Fix `tests/e2e/streaming.spec.ts` — replace `waitForTimeout(2000)` with `waitForFunction` polling for the expected element to appear, eliminating pre-existing flakiness in 2 tests
  - [x] Update `playwright.config.ts` — add `workers: 4` to prevent parallel-execution race conditions against the real backend that caused 6 intermittent failures under 12 workers
  - [x] Create `tests/e2e/query-params.spec.ts` (25 tests) — covers AgentsPanel URL params (8 tests), ContainersPanel URL params (7 tests), TrafficLog URL params (6 tests), cross-panel isolation (3 tests) + end-to-end shareability test
  - [x] Build: npm run build — clean, 98 modules
  - [x] Test: npx playwright test — 450/450 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 30: Click-to-copy for IDs and results**
  - [x] Create `src/components/CopyButton.tsx` — small icon button that copies text to clipboard using `navigator.clipboard.writeText`; shows "Copied!" feedback for 1.5 s then reverts; accessible with `aria-label`, `title`, keyboard-operable
  - [x] Add `<CopyButton>` next to Agent IDs in `AgentsPanel.tsx` rows (expanded detail) and `AgentDetailPage.tsx` Overview tab
  - [x] Add `<CopyButton>` next to Kubex IDs in `ContainersPanel.tsx` rows
  - [x] Add `<CopyButton>` next to task IDs in `OrchestratorChat.tsx` result bubbles and copy-result button for full result content
  - [x] Add `<CopyButton>` next to task IDs in `TrafficLog.tsx` rows
  - [x] Create `tests/e2e/copy-button.spec.ts` — tests: button renders, clipboard write called, "Copied!" feedback shown, button in agent panel, button in containers panel, button in orchestrator result, button in traffic log
  - [x] Build: npm run build — clean, 97 modules
  - [x] Test: npx playwright test — 425/425 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 29: Agent capability matrix**
  - [x] Create `src/components/CapabilityMatrix.tsx` — grid/table showing agents as rows and all unique capabilities as columns; filled cells (✓) indicate the agent has that capability; empty cells (–) indicate it does not; coverage count per column shows how many agents share each capability; agent status dot in each row; columns sorted alphabetically; horizontal scroll for wide fleets; full `aria-label` accessibility on every cell; `role="grid"` with `aria-label` on the table
  - [x] Add `<CapabilityMatrix agents={agents}>` to `AgentsPanel.tsx` — rendered below the table + pagination when `agents.length > 0`; updates whenever the polling refresh returns new agent data
  - [x] Create `tests/e2e/capability-matrix.spec.ts` (17 tests)
  - [x] Fix `tests/e2e/export.spec.ts` — update 4 agent export tests to use `.first()` to avoid Playwright strict-mode violation caused by the matrix now rendering agent IDs a second time on the same page
  - [x] Fix `tests/e2e/skeletons.spec.ts` — update 1 test with `.first()` for same reason
  - [x] Build: npm run build — clean, 96 modules
  - [x] Test: npx playwright test — 414/414 passed
  - [x] Update `docs/CHANGELOG.md`

- [x] **Iteration 14: Performance pass — React.memo, useMemo, virtualized lists**
  - [x] **React.memo on pure sub-components** — wrapped `AgentRow` (AgentsPanel), `KubexRow` (ContainersPanel), `ApprovalCard` (ApprovalQueue), `ChatBubble` (OrchestratorChat), `ServiceCard`, `StatusBadge`, `Sparkline`, `Pagination`, and `SearchInput` with `React.memo`; each of these re-renders on every parent poll tick even when their own props have not changed
  - [x] **useMemo for derived data** — confirmed `useSearch`, `useSort`, `usePagination` each use internal `useMemo`; added explanatory comments in AgentsPanel; TrafficLog `agentIds` and `filteredEntries` both use `useMemo` with minimal dependency arrays
  - [x] **useCallback audit** — added comments in Dashboard's `loadAgents` and `loadKubexes` confirming `agentSeries.push` / `kubexSeries.push` are intentionally omitted from deps (ref-based push, stable identity)
  - [x] **Virtualized list for TrafficLog** — @tanstack/react-virtual NOT added (too heavy per task spec); existing pagination (20/page) already limits DOM nodes; localStorage cap verified at 500 entries in AppContext (`addTrafficEntry` slices to 500); cap confirmed by test
  - [x] **Clear chat button added** — added "Clear" button to OrchestratorChat input area; clears messages to initial welcome message; unbounded chat list is managed by pagination via future work
  - [x] **Code-split ApprovalQueue and AgentDetailPage** — both already `lazy()`-imported in App.tsx; chunk sizes documented in comment block at top of App.tsx (gzip: Dashboard 3.1 KB, OrchestratorChat 4.1 KB, index bundle 66 KB)
  - [x] **localStorage Date rehydration bug fixed** — AppContext now rehydrates ISO string timestamps back to `Date` objects on load (both `trafficLog` and `chatMessages`); fixes crash when app loads with persisted entries
  - [x] Create tests/e2e/performance.spec.ts — 12 tests: pagination limits DOM (far fewer than 200 rows), localStorage cap at 500, rapid navigation doesn't crash, no ResizeObserver errors, page load times under 3s, memo components render correctly, Clear chat button present
  - [x] Verify: npm run build clean + npx playwright test passes (154/154)
  - [x] Commit
