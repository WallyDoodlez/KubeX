# Command Center Changelog

> Tracks what changed in each iteration. Updated after every iteration completes.

---

## Iteration 38: Quick Dispatch Modal (Ctrl+D)
**Files created:** `src/components/QuickDispatchModal.tsx`, `tests/e2e/quick-dispatch.spec.ts`
**Files modified:** `src/components/Layout.tsx`, `src/components/CommandPalette.tsx`, `src/components/KeyboardShortcutsHelp.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/components/QuickDispatchModal.tsx` — global modal overlay for dispatching tasks to any agent from any page in the app. Key details: agent selector uses `useFavorites` to sort favorited agents to the top and groups them into `<optgroup>` sections ("★ Pinned" and "All Agents"); capability input includes real-time autocomplete seeded from the selected agent's capabilities (or all capabilities if none selected) with ArrowDown/Up/Enter keyboard navigation and mousedown-based selection to prevent blur race; three-way priority radio-group (Low / Normal / High); validates with existing `validateCapability` / `validateMessage` utils on submit and on blur with clear-on-type UX; dispatches via `dispatchTask(capability, message, agentId)` API and adds a `TrafficEntry` to the global traffic log via `addTrafficEntry` from `AppContext`; inline success/error result panel with `aria-live="polite"`; full reset of all form state (capability, message, priority, errors, result, suggestions) on each open; backdrop click, Escape, Cancel, and close-icon all close the modal.
- Updated `src/components/Layout.tsx` — added `Ctrl+D` shortcut to `useKeyboardShortcuts` (`ctrl: true`, `allowInInput: true`, toggles `quickDispatchOpen`); added `QuickDispatchOpen` to the Escape handler chain; added `<QuickDispatchModal>` to JSX after CommandPalette; added "⚡ Dispatch" toolbar button with `^D` hint kbd before the command palette trigger; wired `onOpenQuickDispatch` prop to CommandPalette.
- Updated `src/components/CommandPalette.tsx` — added `onOpenQuickDispatch?: () => void` prop; added `action-quick-dispatch` builtin command in the `Actions` category with description "Send a task to any agent from anywhere (Ctrl+D)" and keywords `['dispatch', 'task', 'send', 'agent', 'quick', 'ctrl+d']`; action closes palette then invokes `onOpenQuickDispatch?.()`.
- Updated `src/components/KeyboardShortcutsHelp.tsx` — added `{ keys: ['Ctrl', 'D'], description: 'Open quick dispatch modal' }` to the Global shortcuts group.
- Created `tests/e2e/quick-dispatch.spec.ts` — 34 tests: toolbar trigger visible; aria-label "Open quick dispatch (Ctrl+D)"; click opens modal; Ctrl+D from Dashboard; Ctrl+D from Agents page (waits for h1 not table); Ctrl+D from Traffic page; second Ctrl+D toggles closed; role=dialog; aria-modal=true; heading "Quick Dispatch"; Ctrl+D kbd hint in header; agent select visible; default empty; capability input; message textarea; three priority buttons; Normal aria-checked=true default; priority click changes aria-checked; submit button; X closes; Escape closes; backdrop click closes; Cancel closes; empty submit shows both errors; cap error text; msg error text; error clears on type; blur shows invalid char error; aria-autocomplete=list; command palette has Quick Dispatch; palette item opens modal; item in Actions category; shortcuts help contains "quick dispatch"; fields empty on reopen; priority resets to Normal on reopen.
**Tests:** 582 → 616 (34 new quick-dispatch tests; all pass)

---

## Iteration 37: Pinned/Favorite Agents
**Files created:** `src/hooks/useFavorites.ts`, `tests/e2e/favorites.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/AgentDetailPage.tsx`, `src/components/Dashboard.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/hooks/useFavorites.ts` — manages a `string[]` of favorited agent IDs in localStorage under the key `kubex-favorite-agents`. Built on `useLocalStorage`. Exposes: `favorites` (raw array), `favoritesSet` (a `Set<string>` for O(1) membership checks in render loops), `isFavorite(id)` (memoized callback), and `toggle(id)` (adds if absent, removes if present via immutable filter/spread).
- Updated `src/components/AgentsPanel.tsx` — imports and wires `useFavorites`. After `useSort`, a stable secondary sort lifts favorited agents to the top of `sortedItems` (preserving relative order within each group). Grid column template extended from `[auto_2fr_3fr_1fr_1fr_auto]` to `[auto_auto_2fr_3fr_1fr_1fr_auto]` to accommodate the star column in both the header row and each data row. When at least one favorited agent is present on the current page, a "Pinned" amber section label renders before the first favorited row. When both pinned and unpinned agents coexist on the page, an "All Agents" separator renders before the first unpinned row. Each `AgentRow` receives `favorited: boolean` and `onToggleFavorite: () => void`; click is `stopPropagation`'d so it does not expand the row.
- Updated `src/components/AgentDetailPage.tsx` — imports `useFavorites`. An amber star button (`data-testid="agent-detail-favorite-btn"`) renders in the heading row between the CopyButton and StatusBadge. Shows `★` (amber) when favorited, `☆` (dim) otherwise. `aria-label` switches between "Pin agent" and "Unpin agent". State reads from the same localStorage key as AgentsPanel — changes on the detail page are immediately reflected in the agents list and vice versa.
- Updated `src/components/Dashboard.tsx` — imports `useFavorites`. The `agents` array is sorted favorites-first before slicing to `AGENT_DISPLAY_LIMIT` for the Registered Agents grid. `AgentCard` accepts an optional `pinned?: boolean` prop: when true, card border is amber (`border-amber-500/30`) and an amber `★` (with `aria-label="Pinned"`) appears before the agent ID.
- Created `tests/e2e/favorites.spec.ts` — 24 tests (1 conditional skip): star button presence; defaults to ☆; aria-label says "Pin agent"; click toggles to ★; aria-label becomes "Unpin agent"; second click toggles back to ☆; no "Pinned" label when none favorited; "Pinned" label appears after first star; label contains ★; "All Agents" separator appears when mixed; Pinned label disappears after unpinning all; favorites persist across page reload; localStorage stores agent IDs; unfavoriting removes from localStorage; favorited agent moves to top of list; top row has filled star; detail page has favorite button; detail defaults to ☆; detail click fills ★; dashboard pinned star icon; star button is focusable; star button tabIndex 0; click does not propagate to row expand.
**Tests:** 559 → 582

---

## Iteration 36: Keyboard-Navigable Tables
**Files created:** `src/hooks/useTableKeyboardNav.ts`, `tests/e2e/keyboard-nav.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `tests/e2e/agents.spec.ts`, `tests/e2e/containers.spec.ts`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/hooks/useTableKeyboardNav.ts` — hook that manages row-level keyboard navigation for flat-list tables. Maintains `focusedIndex` state (starts at -1). Handles `ArrowDown` (move to next row, clamp at last), `ArrowUp` (move to previous row, clamp at first), `Home` (jump to first row), `Enter` (call `onEnter(focusedIndex)`), `Space` (call `onSpace(focusedIndex)`). Returns `handleKeyDown` to attach to the table container and `getRowProps(index, tableId)` which provides `id`, `tabIndex` (0 if focused, -1 otherwise), `aria-rowindex`, `data-nav-index`, and `onFocus` for each row. A stable `ref` ensures the key handler always reads the latest `focusedIndex` without stale closure issues.
- Updated `src/components/AgentsPanel.tsx` — wired `useTableKeyboardNav` to the agent table. Table container upgraded from `role="table"` to `role="grid"` with `aria-label="Registered agents"`, `aria-activedescendant` (points to `agents-table-row-N` when a row is focused), `tabIndex={0}` (makes the container keyboard-focusable), and `outline-none` to suppress the default focus ring on the container. Each `AgentRow` receives `focused` boolean and `rowProps` spread (id, tabIndex, aria-rowindex, data-nav-index, onFocus). Focused row renders with `ring-2 ring-inset ring-emerald-500/60` focus ring. Enter key toggles row expand; Space key toggles row selection.
- Updated `src/components/ContainersPanel.tsx` — identical keyboard navigation pattern applied to the kubex table. Table gets `role="grid"`, `aria-label="Docker containers"`, `aria-activedescendant`, `tabIndex={0}`. Each `KubexRow` receives `focused` and `rowProps`. Space key toggles kubex selection. (KubexRow has no expand — Enter not wired for containers since there is no detail expand UX.)
- Updated `tests/e2e/agents.spec.ts` — changed `[role="table"]` selector to `[data-testid="agents-table"]` with `toHaveAttribute('role', 'grid')` to avoid matching the Capability Matrix grid that also uses `role="grid"`.
- Updated `tests/e2e/containers.spec.ts` — changed `[role="table"]` selectors to `[role="grid"]` for the two tests that were checking table presence.
- Created `tests/e2e/keyboard-nav.spec.ts` — 47 tests: Agents table (15 tests): role=grid, aria-label, tabIndex=0, rows have data-nav-index/aria-rowindex/id, ArrowDown to first row, ArrowDown twice to second, ArrowUp back, Home key, three ArrowDown presses reach third row, focused row has ring-2, non-focused row no ring, aria-activedescendant updates, Enter expands row, Space selects row, click syncs focused index. Containers table (15 tests): identical coverage.
**Tests:** 529 → 559

---

## Iteration 35: Collapsible Dashboard Sections
**Files created:** `src/hooks/useCollapsible.ts`, `src/components/CollapsibleSection.tsx`, `tests/e2e/collapsible-sections.spec.ts`
**Files modified:** `src/components/Dashboard.tsx`, `src/components/ActivityFeed.tsx`, `tests/e2e/activity-feed.spec.ts`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/hooks/useCollapsible.ts` — manages collapse state for named dashboard sections, persisted in localStorage via `useLocalStorage`. API: `isCollapsed(id)` reads current state (defaults to false/expanded), `toggle(id)` flips it, `setCollapsed(id, bool)` sets explicitly. State is stored as a `Record<string, boolean>` under the caller-supplied storage key.
- Created `src/components/CollapsibleSection.tsx` — wrapper component with a clickable `<button>` header that toggles content visibility. Features: `aria-expanded` attribute tracks state; `aria-controls` links to panel id; `role="region"` + `aria-labelledby` on content for screen readers; chevron rotates -90° when collapsed via CSS transition; smooth height animation using `scrollHeight` measurement — collapses to 0, expands to scrollHeight then releases to `auto`; `subtitle` and `action` props only rendered when expanded; all regions addressable via `data-testid`.
- Updated `src/components/Dashboard.tsx` — replaced bare `<section>` wrappers for Service Health, Registered Agents, and Activity Feed with `<CollapsibleSection>`. Collapse state persisted under `'kubex-dashboard-sections'` in localStorage. ActivityFeed rendered with `hideHeader` to avoid duplicate heading.
- Updated `src/components/ActivityFeed.tsx` — added optional `hideHeader?: boolean` prop (default `false`). When true, the internal section header (h2, subtitle p, "View all →" button) is suppressed so the parent CollapsibleSection can own the header layout.
- Created `tests/e2e/collapsible-sections.spec.ts` — 22 tests: section presence (3), toggle button visibility (3), default `aria-expanded=true` state (3), section title visibility (3), collapse sets `aria-expanded=false` (3), toggle idempotency (1), localStorage persistence after collapse (1), expanded state leaves storage clean (1), persistence across page reload (1), independent multi-section collapse (1), `aria-controls` attribute correctness (1), panel `role=region` + `aria-labelledby` (1).
- Updated `tests/e2e/activity-feed.spec.ts` — updated 4 tests whose selectors referenced the ActivityFeed's now-suppressed header: "Recent Activity" heading now found in `[data-testid="collapsible-section-activity-feed"] h2`; subtitle count now found in the CollapsibleSection toggle button's `p` element; "View all →" button now found as the CollapsibleSection action button scoped to the activity-feed section.
**Tests:** 507 → 529

---

## Iteration 34: Task History Page
**Files created:** `src/components/TaskHistoryPage.tsx`, `tests/e2e/task-history.spec.ts`
**Files modified:** `src/App.tsx`, `src/components/Layout.tsx`, `src/components/CommandPalette.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/components/TaskHistoryPage.tsx` — dedicated full-page table view of all dispatched tasks, extracted from the traffic log by filtering `TrafficEntry` records where `action === 'dispatch_task'`. Columns: expand toggle, Task ID, Agent, Capability, Status, Dispatched. Features: status filter bar (All/Allowed/Denied/Escalated/Pending) via pill buttons with `aria-pressed`; debounced search across task_id, agent_id, capability via `useSearch`; sortable columns (task_id, agent_id, capability, status, dispatched_at) via `useSort` with stable module-level comparators; pagination at 20 rows/page via `usePagination`; URL-persisted state (status, search, sort, dir, page) via `useQueryParams`; expandable detail rows showing task metadata (task_id, agent_id, capability, policy_rule, dispatched ISO timestamp) and JSON pretty-print of `entry.details`; `CopyButton` on task_id and agent_id in expanded rows; `RelativeTime` for dispatched timestamps; export to JSON and CSV via `ExportMenu`; `EmptyState` for both "no tasks ever dispatched" and "no tasks match filters" cases. `TaskRow` and `DetailRow` are `React.memo`'d to avoid re-renders.
- Updated `src/App.tsx` — added `LazyTaskHistoryPage` (lazy-loaded chunk); added `TasksPage` function component that reads `trafficLog` from `AppContext` and renders `LazyTaskHistoryPage`; added `/tasks` route inside the `Routes` block.
- Updated `src/components/Layout.tsx` — added `{ label: 'Tasks', icon: '✦', description: 'Dispatched tasks', path: '/tasks' }` to `NAV_ITEMS` between Orchestrator and Containers; added `G+h` two-key keyboard shortcut handler (`navigate('/tasks')`) in the `useKeyboardShortcuts` call.
- Updated `src/components/CommandPalette.tsx` — added built-in "Go to Task History" nav command (id: `nav-tasks`, icon: `✦`, keywords: tasks/history/dispatched/results/status).
- Created `tests/e2e/task-history.spec.ts` — 14 tests covering: header shows "Tasks", nav item visible in sidebar, sidebar aria-current on active page, Task History heading, empty state when no dispatch_task entries, empty state description text, navigation from sidebar, app shell intact, direct URL navigation, all five status filter buttons present with `exact: true`, search input present, export menu present, All filter button has `aria-pressed=true` by default, command palette search finds the Tasks entry.
**Tests:** 493 → 507

---

## Iteration 33: Batch Operations for Agents and Kubexes
**Files created:** `src/hooks/useSelection.ts`, `src/components/SelectionBar.tsx`, `tests/e2e/batch-operations.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/hooks/useSelection.ts` — lightweight selection manager for table rows. Maintains a `Set<string>` of selected IDs. Provides `toggleOne(id)` (add/remove single ID), `toggleAll(allIds)` (select all, or deselect all if all already selected), `clearSelection()`, `isSelected(id)`, `selectedCount`, and `someSelected`. All mutators are stable `useCallback` references to avoid unnecessary re-renders in `React.memo` row components.
- Created `src/components/SelectionBar.tsx` — floating action bar rendered below the table when `selectedCount > 0`. Displays a green badge with the selected item count, a labeled count string ("N agents selected"), configurable bulk-action buttons (danger/warning/success/default variants), and a "Clear" dismiss button. Renders `null` when nothing is selected so it doesn't affect layout. Uses `role="toolbar"` and `aria-label` for accessibility. Accepts `data-testid` props on the bar and each action button for E2E targeting.
- Updated `src/components/AgentsPanel.tsx` — added a leading checkbox column to both the table header (select-all with indeterminate state) and every `AgentRow`. Row checkbox stops click propagation so it doesn't toggle the expand accordion. Selected rows receive a subtle emerald highlight. Wired `useSelection`; the `toggleAll` call passes all `sortedItems` IDs so select-all/deselect-all operates on the full filtered result set, not just the current page. Added `SelectionBar` with a "Deregister Selected" danger action that opens a `ConfirmDialog` showing the count before proceeding. Bulk deregister uses `Promise.allSettled` to run all API calls in parallel with per-item failure tolerance; clears selection and reloads after completion.
- Updated `src/components/ContainersPanel.tsx` — same pattern as AgentsPanel. Added checkbox column and `useSelection`. Wires `SelectionBar` with context-aware bulk actions: "Kill Selected" appears only when at least one running kubex is in the selection; "Start Selected" appears only when at least one stopped/created kubex is in the selection; both appear for mixed selections. "Kill Selected" requires a confirm dialog. "Start Selected" executes immediately via `Promise.allSettled`. Both clear selection and reload after completion.
- Created `tests/e2e/batch-operations.spec.ts` — 25 tests: AgentsPanel (14 tests): row checkboxes present, select-all present, bar hidden when empty, bar shows count after selecting 1, bar shows correct count for 2, select-all selects all 3 agents, select-all deselects when all selected, clear button deselects all, bulk deregister button visible when selected, bulk deregister opens confirm dialog, confirm dialog shows correct count, cancelling dialog keeps selection, selecting a row highlights it; ContainersPanel (11 tests): row checkboxes present, select-all present, bar hidden when empty, selecting 1 shows bar, select-all selects all, clear deselects, kill button appears for running selection, start button appears for stopped selection, kill button opens confirm dialog, cancelling dialog keeps selection, stopped-only selection hides kill button, mixed selection shows both buttons.
**Tests:** 468 → 493

---

## Iteration 32: OAuth Authentication Scaffolding
**Files created:** `src/services/auth.ts`, `src/components/LoginPage.tsx`, `src/components/UserMenu.tsx`, `src/components/AuthCallbackPage.tsx`, `tests/e2e/oauth.spec.ts`
**Files modified:** `src/context/AuthContext.tsx`, `src/api.ts`, `src/App.tsx`, `src/components/Layout.tsx`, `docs/FE-BE-REQUESTS.md`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `src/services/auth.ts` — OAuth 2.0 Authorization Code + PKCE (RFC 7636) service layer. Provides: `login()` (builds authorize URL with PKCE challenge and redirects browser), `handleCallback()` (exchanges code for tokens, verifies state, fetches user profile), `refreshToken()` (sends refresh grant, clears session on failure), `logout()` (clears sessionStorage tokens, redirects to provider RP-Initiated Logout endpoint), `getAccessToken()` (returns OAuth token or falls back to `VITE_MANAGER_TOKEN`), `isAuthenticated()` (checks expiry with 5 s buffer), `getUser()` (returns cached OIDC profile from sessionStorage), `isOAuthConfigured()` (returns true iff `VITE_OAUTH_AUTHORITY` is set). All storage is namespaced under `kubex_oauth_` prefix. When `VITE_OAUTH_AUTHORITY` is not set every method returns safe defaults — zero behaviour change for existing deployments.
- Updated `src/context/AuthContext.tsx` — integrated OAuth service alongside the existing legacy token API. Added `oauthEnabled`, `isAuthenticated`, `user`, `login()`, `logout()` to `AuthContextValue`. Legacy API (`token`, `setToken`, `isConfigured`, `clearToken`) remains 100% intact for backward compatibility. `token` and `isConfigured` transparently reflect the OAuth access token when OAuth is active. `login()` delegates to `oauthLogin()` in OAuth mode; is a no-op in legacy mode. `logout()` calls `oauthLogout()` (redirect) in OAuth mode; calls `clearToken()` in legacy mode.
- Created `src/components/LoginPage.tsx` — full-screen sign-in page shown by `OAuthGate` when `oauthEnabled=true` and the user is not authenticated. Contains KubexClaw logo, "Sign in with OAuth" button (PKCE redirect), loading spinner during redirect, and error display if `login()` throws. Not rendered in legacy mode.
- Created `src/components/UserMenu.tsx` — top-bar user avatar + dropdown rendered in `Layout.tsx`. In OAuth mode: shows profile avatar (or initials), name, email and "OAuth" badge. In legacy mode: shows "T" initial and "Bearer token active" label. Dropdown has a "Sign out" / "Clear token" action. Closes on Escape (with focus return to trigger) and outside click. Fully accessible: `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`.
- Created `src/components/AuthCallbackPage.tsx` — handles the OAuth redirect at `/auth/callback`. Calls `handleCallback(window.location.href)` on mount, navigates to `/` on success, shows a branded error screen on failure. In legacy mode (no OAuth config) immediately redirects to `/`. Lazy-loaded.
- Updated `src/App.tsx` — added `OAuthGate` wrapper component that intercepts renders: (a) if the current path is `/auth/callback`, renders `AuthCallbackPage` directly (bypasses Layout); (b) if `oauthEnabled=true` and `isAuthenticated=false`, renders `LoginPage`; (c) otherwise passes through to the normal app tree. Added `/auth/callback` route inside the route tree as well. Both new pages are lazy-loaded (`LazyAuthCallbackPage`, `LazyLoginPage`).
- Updated `src/components/Layout.tsx` — imported `UserMenu` and added `<UserMenu />` between `NotificationCenter` and the separator divider in the top bar toolbar. Renders correctly in both OAuth and legacy modes.
- Updated `src/api.ts` — imported `getAccessToken` from `src/services/auth`; `managerHeaders()` now calls `getAccessToken()` which prefers the OAuth access token over the static `VITE_MANAGER_TOKEN` env var. Backward compatible: when OAuth is not configured `getAccessToken()` returns `VITE_MANAGER_TOKEN`.
- Updated `docs/FE-BE-REQUESTS.md` — added OAuth endpoints section documenting four new backend requirements: `POST /authorize` (PKCE authorization), `POST /token` (code exchange + refresh), `GET /userinfo` (OIDC profile), `GET /logout` (RP-Initiated Logout); added compatibility note that backend services must accept JWT bearer tokens once OAuth ships; added entries 21–24 to the summary table.
- Created `tests/e2e/oauth.spec.ts` — 18 tests covering: legacy mode compatibility (app loads normally, login page hidden, navigation works), callback route registration (no crash, no 404), auth service module (`isOAuthConfigured` behaviour, sessionStorage scoping), UserMenu accessibility (aria attributes, dropdown open/close, Escape key, outside click), OAuthGate pass-through in legacy mode (all nav links work), and `window.location.pathname` guard for callback route.
**Tests:** 450 → 468

---

## Iteration 31: URL query params for shareable filters
**Files created:** `src/hooks/useQueryParams.ts`, `tests/e2e/query-params.spec.ts`
**Files modified:** `src/hooks/useSearch.ts`, `src/hooks/useSort.ts`, `src/components/AgentsPanel.tsx`, `src/components/ContainersPanel.tsx`, `src/components/TrafficLog.tsx`, `tests/e2e/streaming.spec.ts`, `playwright.config.ts`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `useQueryParams.ts` — a typed hook wrapping React Router's `useSearchParams`. Accepts a `defaults` record; reads current values from URL (falling back to defaults); writes updates via `setSearchParams` with `replace: !push`. Values equal to their defaults are deleted from the URL to keep shared links clean. Browser back/forward is handled natively by React Router's history integration.
- Updated `useSearch.ts` — added optional `initialQuery` option to seed the search `useState` from a URL param on mount, avoiding a round-trip effect cycle.
- Updated `useSort.ts` — added optional `initialSortConfig` parameter to restore sort key+direction from a URL param on mount.
- Updated `AgentsPanel.tsx` — imports `useQueryParams`; wires `search`, `sort`, `dir`, `page` params; `handleSearchChange` updates URL with `push=false` on keystrokes; `handleRequestSort` updates `sort`/`dir` with `push=false`; page navigation wrappers update `page` param; `initialQuery` and `initialSortConfig` are derived from URL params and passed to `useSearch`/`useSort` so the view restores correctly on direct navigation (e.g. `/agents?search=beta&sort=status&dir=asc`).
- Updated `ContainersPanel.tsx` — same pattern; additionally wires `status` filter param using `push=true` so switching status filter is browser-navigable; `initialQuery` and `initialSortConfig` restore from URL; status filter derives from URL param with validation against allowed values.
- Updated `TrafficLog.tsx` — replaces `useState<TrafficFilter>` with URL-driven filter; `status` and `agent` filter changes use `push=true` (discrete choices); `search` keystrokes use `push=false`; `page` param updated by pagination wrappers; all filter state is restored from URL on direct navigation to `/traffic?status=denied&agent=xyz`.
- Fixed `tests/e2e/streaming.spec.ts` — replaced `waitForTimeout(2000)` with `page.waitForFunction` polling until either `role="tablist"` or "Back to Agents" text appears. This eliminates the pre-existing flakiness where 2 tests reliably failed when the lazy-loaded `AgentDetailPage` wasn't fully rendered within the 2 s hard timeout.
- Updated `playwright.config.ts` — added `workers: 4` (down from default 12). The test suite hits a real backend; 12 concurrent workers caused intermittent failures in 6 tests (agent-detail, capability-matrix, system-status) due to race conditions on shared backend state. Reducing to 4 workers eliminates these without sacrificing meaningful parallelism.
- Created `tests/e2e/query-params.spec.ts` — 25 tests: AgentsPanel search → URL, URL search → input restore, filter applies on load, clearing search clears URL, sort → URL, URL sort → indicator, multiple params together, sort toggle, defaults not added; ContainersPanel status → URL, URL status → dropdown, search → URL, URL search → input, sort → URL, URL sort → indicator, default not added; TrafficLog status → URL, URL status → select, search → URL, URL search → input, defaults not added, params persist across navigation; cross-panel: no param leak between pages, end-to-end shareability.
**Tests:** 425 → 450

---

## Iteration 30: Click-to-copy for IDs and results
**Files created:** `src/components/CopyButton.tsx`, `tests/e2e/copy-button.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `src/components/AgentDetailPage.tsx`, `src/components/ContainersPanel.tsx`, `src/components/OrchestratorChat.tsx`, `src/components/TrafficLog.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `CopyButton.tsx` — a small inline icon button (16×16 px) that copies any `text` prop to the clipboard via `navigator.clipboard.writeText`. Displays a clipboard SVG in the idle state; switches to a checkmark SVG for 1.5 s after a successful copy, with `aria-label` and `title` both updating to "Copied!" for screen reader and tooltip feedback. Reverts automatically after the timeout. Keyboard-operable via `Enter`/`Space`. Falls back silently when the Clipboard API is unavailable (incognito / older browsers). Accepts optional `className`, `ariaLabel`, and `testId` props.
- Updated `AgentsPanel.tsx` — added `CopyButton` import; extended `DetailField` component with optional `copyable` prop; set `copyable` on the `agent_id` field in the expanded row detail panel.
- Updated `AgentDetailPage.tsx` — added `CopyButton` import; placed a copy button immediately after the agent ID heading text; extended `InfoCard` with optional `copyable` prop and set it on the Agent ID card in the Overview tab; added a copy button next to task IDs in the Dispatch History rows.
- Updated `ContainersPanel.tsx` — added `CopyButton` import; wrapped the kubex ID cell in a flex container with a `CopyButton` next to the truncated ID span.
- Updated `OrchestratorChat.tsx` — added `CopyButton` import; in result `ChatBubble`, added a copy button next to the task ID label and a second copy button (right-aligned, "Copy result content") that copies the entire `message.content` text.
- Updated `TrafficLog.tsx` — added `CopyButton` import; in `TrafficRow`, when a `task_id` is present, wrapped it in a flex span with a `CopyButton`; policy_rule-only rows remain plain text.
- Created `tests/e2e/copy-button.spec.ts` — 11 tests: component presence in agents expanded row, containers panel kubex rows; clipboard `writeText` invocation verified via `page.exposeFunction`; "Copied!" aria-label appears after click; aria-label reverts after 1.5 s; orchestrator chat area renders cleanly; traffic log copy button count is non-negative; agent detail heading copy button; agent detail InfoCard copy button; keyboard operability (Enter key); title and aria-label attributes present.
**Tests:** 414 → 425

---

## Iteration 29: Agent capability matrix
**Files created:** `src/components/CapabilityMatrix.tsx`, `tests/e2e/capability-matrix.spec.ts`
**Files modified:** `src/components/AgentsPanel.tsx`, `tests/e2e/export.spec.ts`, `tests/e2e/skeletons.spec.ts`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `CapabilityMatrix.tsx` — a `role="grid"` table component that displays all registered agents as rows and all unique capabilities across the fleet as columns. Filled cells show a green ✓ badge (bg-emerald-500/15); empty cells show a muted dash. Each cell carries an `aria-label` describing whether the agent has or does not have the capability. The coverage row at the top of each column shows a `N/M` fraction indicating how many of the M agents carry that capability, with an `aria-label` for screen readers. Columns are sorted alphabetically via `useMemo`. Agent rows include a colored status dot (running=emerald, idle=blue, busy=amber, stopped=slate, etc.) and truncate long agent IDs with a tooltip. The table wrapper is horizontally scrollable to handle wide capability sets. The agent ID column is sticky (`sticky left-0`) so it remains visible while scrolling.
- Updated `AgentsPanel.tsx` — imported and mounted `<CapabilityMatrix agents={agents} />` in a `mt-6` `<div>` below the pagination controls, guarded by `agents.length > 0`. The matrix receives the same `agents` array loaded by the panel's `usePolling` hook, so it automatically updates on every 10 s refresh.
- Created `tests/e2e/capability-matrix.spec.ts` — 17 tests covering: section presence, heading, subtitle format (agent count + capability count), `role="grid"` + `aria-label`, at least one row rendered, at least one column rendered, coverage count format (`N/M`), coverage count `aria-label`, cell count equals rows × columns, cells contain only ✓ or –, filled cell `aria-label` contains "has", empty cell `aria-label` contains "does not have", alphabetical column sort, navigation persistence, and bounding-box visibility.
- Fixed `tests/e2e/export.spec.ts` — updated 4 Agents Panel export tests that used `page.getByText('agent-export-test-01')` (strict mode) to use `.first()` since the agent ID now appears in both the agents table and the capability matrix row.
- Fixed `tests/e2e/skeletons.spec.ts` — updated 1 agents skeleton test with `.first()` for the same reason.
**Tests:** 397 → 414

---

## Iteration 28: Unified relative timestamps
**Files created:** `src/components/RelativeTime.tsx`, `tests/e2e/relative-time.spec.ts`
**Files modified:** `src/components/TrafficLog.tsx`, `src/components/ActivityFeed.tsx`, `src/components/OrchestratorChat.tsx`, `src/components/ApprovalQueue.tsx`, `IMPROVEMENTS.md`, `docs/CHANGELOG.md`
**Changes:**
- Created `RelativeTime.tsx` — a `<time>` element that renders a human-friendly relative label ("just now", "30s ago", "5m ago", "2h ago", "1d ago") with the full ISO-8601 date as a `title` tooltip and in the `dateTime` attribute for semantic HTML. Uses a shared singleton `setInterval(30 000 ms)` so all mounted instances tick together without each spawning their own timer.
- Replaced `toLocaleTimeString()` in `TrafficLog.tsx` row timestamps with `<RelativeTime>`, adding `data-testid="traffic-row-timestamp"` for test targeting.
- Removed the ad-hoc `formatTime()` function from `ActivityFeed.tsx`; replaced the timestamp `<span>` with `<RelativeTime data-testid="activity-row-timestamp">`.
- Replaced the three `toLocaleTimeString()` calls inside `ChatBubble` variants in `OrchestratorChat.tsx` (user, error, result bubbles) with `<RelativeTime data-testid="chat-bubble-timestamp">`.
- Replaced the inline `pendingFor` calculation and `setTick` re-render interval (10 s) in `ApprovalQueue.tsx` with `<RelativeTime data-testid="approval-card-timestamp">`, removing the now-unnecessary `useEffect` timer.
- Created `tests/e2e/relative-time.spec.ts` — 15 tests covering: TrafficLog `<time>` element presence, `dateTime` attribute format, "just now" for recent entries, "Xm ago" for older entries, tooltip content; ActivityFeed `<time>` element, relative label regex, tooltip; OrchestratorChat bubble `<time>` element, label, tooltip; ApprovalQueue page loads cleanly and shows empty state; semantic HTML cross-surface validation including "Xh ago" and "1d ago" ranges.
**Tests:** 382 → 397

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
