# Command Center Improvement Tracker

> **Loop protocol:** Check for `[~]` (resume) before `[ ]` (start next). Mark `[x]` only after build + tests pass.

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

- [ ] **Iteration 13: Replace ad-hoc loading/empty states with SkeletonLoader + EmptyState**
  - [ ] **AgentsPanel.tsx** — replace the inline `[1,2,3].map(i => <div animate-pulse>)` skeleton with `<SkeletonTable rows={3} cols={5} />`; replace the local `EmptyState` function component with the shared `<EmptyState icon="◎" title="No agents registered" description="Run docker compose up to start agents." />`
  - [ ] **ContainersPanel.tsx** — replace the inline `[1,2,3].map(i => <div animate-pulse>)` skeleton with `<SkeletonTable rows={3} cols={5} />`; replace the local `EmptyContainers` function component with the shared `<EmptyState icon="⬡" title="No kubexes found" description="Kubexes appear here when spawned via Manager." />`
  - [ ] **AgentDetailPage.tsx** — replace the bespoke two-div loading shimmer (lines 47–52) with `<SkeletonCard />` followed by `<SkeletonText lines={4} />`; replace the ad-hoc error/not-found block with `<EmptyState icon="⚠" title="Agent not found" description={error} action={{ label: '← Back', onClick: () => navigate('/agents') }} />`
  - [ ] **Dashboard.tsx** — replace the inline `<span className="animate-pulse">Loading agents…</span>` block with `<SkeletonCard />` cards matching the agent card grid layout; replace the local `EmptyState` function at the bottom of the file with the shared component
  - [ ] **ApprovalQueue.tsx** — replace the hardcoded empty-state `<div>` (lines 49–56) with `<EmptyState icon="✓" title="No pending approvals" description="Escalated actions from the policy engine will appear here." />`; the component currently has no loading state at all — add one using `<SkeletonCard rows={2} />` while `getEscalations()` resolves (ApprovalQueue uses mock data today but the skeleton should be in place for when the real API lands)
  - [ ] Delete all local `EmptyState`/`EmptyContainers` function declarations that were copy-pasted into individual component files — they are now superseded by the shared component
  - [ ] Create tests/e2e/skeletons.spec.ts — intercept API routes with a delayed MSW handler; assert `aria-busy="true"` skeleton elements appear during load; assert they disappear and real content renders after the response resolves
  - [ ] Verify: npm run build clean + npx playwright test passes
  - [ ] Commit

- [ ] **Iteration 14: Performance pass — React.memo, useMemo, virtualized lists**
  - [ ] **React.memo on pure sub-components** — wrap `AgentRow` (AgentsPanel), `KubexRow` (ContainersPanel), `ApprovalCard` (ApprovalQueue), `ChatBubble` (OrchestratorChat), `ServiceCard`, `StatusBadge`, `Sparkline`, `Pagination`, and `SearchInput` with `React.memo`; each of these re-renders on every parent poll tick even when their own props have not changed
  - [ ] **useMemo for derived data** — in AgentsPanel, the `sortComparators` object is already at module level (good), but `searchedAgents → sortedItems → paginatedItems` chain re-runs on every keystroke; confirm `useSearch`, `useSort`, `usePagination` each use internal `useMemo` — if not, add it; in TrafficLog, `agentIds` derivation already uses `useMemo` (good); audit `filteredEntries` to ensure the dependency array is minimal
  - [ ] **useCallback audit** — Dashboard's `checkHealth`, `loadAgents`, `loadKubexes` are wrapped in `useCallback` but depend on `agentSeries.push` and `kubexSeries.push` which come from `useTimeSeries`; verify those refs are stable across renders (they should be, since `useTimeSeries` returns a ref-based `push`) — add a comment confirming this is intentional
  - [ ] **Virtualized list for TrafficLog** — TrafficLog can hold thousands of entries in localStorage; replace the paginated `div` stack with `@tanstack/react-virtual` (row virtualizer) for the visible page, keeping pagination as a fallback for non-JS environments; cap localStorage traffic log at 500 entries in AppContext to prevent unbounded growth
  - [ ] **Virtualized list for OrchestratorChat messages** — the chat message list grows unbounded in localStorage; apply the same row virtualizer pattern; add a "Clear chat" button next to the existing chat input area
  - [ ] **Code-split ApprovalQueue and AgentDetailPage** — both are already `lazy()`-imported in App.tsx (good); confirm chunk sizes via `npm run build -- --report` and document the resulting chunk sizes in a comment block at the top of App.tsx
  - [ ] Create tests/e2e/performance.spec.ts — load TrafficLog with 200 mock entries; assert that the DOM contains far fewer than 200 row elements (virtualizer is working); assert scroll works without layout thrash (no `ResizeObserver loop` console errors)
  - [ ] Verify: npm run build clean + npx playwright test passes
  - [ ] Commit
