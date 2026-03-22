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

- [ ] **Iteration 11: Polish + Accessibility Audit**
  - [ ] Create src/components/SkeletonLoader.tsx (reusable SkeletonTable, SkeletonCard, SkeletonText)
  - [ ] Create src/components/EmptyState.tsx (reusable empty state)
  - [ ] Upgrade Layout.tsx — skip-to-content, aria-current, responsive sidebar, landmark roles
  - [ ] Audit all components — focus-visible rings, ARIA labels, semantic HTML
  - [ ] Update index.css — focus-visible utilities, print stylesheet
  - [ ] Create tests/e2e/accessibility.spec.ts (axe-core scan, landmarks, tab order)
  - [ ] Create tests/e2e/responsive.spec.ts (sidebar breakpoints)
  - [ ] Create tests/e2e/integration.spec.ts (full user flow: dispatch → stream → HITL → traffic → persist)
  - [ ] Verify: npm run build clean + npx playwright test ALL green
  - [ ] Commit
