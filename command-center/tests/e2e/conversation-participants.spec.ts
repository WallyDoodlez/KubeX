/**
 * E2E tests for Iteration 96 — Conversation Participant Model
 *
 * Covers:
 * 1. agent_joined chunk events produce system messages
 * 2. agent_left chunk events produce system messages (with failure suffix)
 * 3. hitl_request chunk events with source_agent show attribution
 * 4. Result bubbles show agent name as sender badge
 * 5. Duplicate join events are deduplicated
 */

import { test, expect } from '@playwright/test';
import { mockBaseRoutes, mockDispatch, mockSSEStream, mockTaskResult, GATEWAY } from './helpers';

const TASK_ID = 'task-participant-001';
const CHAT_MESSAGES_KEY = 'kubex-chat-messages';

// ── SSE body builders ──────────────────────────────────────────────

/** Build an SSE body with chunk-encoded structured events followed by a result */
function buildParticipantSSE(taskId: string): string {
  const lines: string[] = [];

  // agent_joined event
  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_joined',
        agent_id: 'knowledge',
        sub_task_id: 'sub-001',
        capability: 'knowledge_management',
      }),
      final: false,
    })}\n`,
  );

  // Some progress output
  lines.push(
    `data: ${JSON.stringify({
      type: 'stdout',
      text: 'Processing query...',
    })}\n`,
  );

  // agent_left event
  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_left',
        agent_id: 'knowledge',
        sub_task_id: 'sub-001',
        status: 'resolved',
      }),
      final: false,
    })}\n`,
  );

  // Final result
  lines.push(
    `data: ${JSON.stringify({
      type: 'result',
      result: 'Task completed by orchestrator.',
      agent_id: 'orchestrator',
    })}\n`,
  );

  return lines.join('\n');
}

/** Build SSE with agent_left status=failed */
function buildFailedLeaveSSE(taskId: string): string {
  const lines: string[] = [];

  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_joined',
        agent_id: 'scraper',
        sub_task_id: 'sub-002',
        capability: 'web_scraping',
      }),
      final: false,
    })}\n`,
  );

  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_left',
        agent_id: 'scraper',
        sub_task_id: 'sub-002',
        status: 'failed',
      }),
      final: false,
    })}\n`,
  );

  lines.push(
    `data: ${JSON.stringify({
      type: 'result',
      result: 'Task completed despite failure.',
    })}\n`,
  );

  return lines.join('\n');
}

/** Build SSE with hitl_request containing source_agent.
 *  We also include a top-level hitl_request event (non-chunk) as fallback
 *  to ensure the HITL prompt renders even if chunk parsing has issues. */
function buildHITLAttributionSSE(taskId: string): string {
  const lines: string[] = [];

  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_joined',
        agent_id: 'instagram-scraper',
        sub_task_id: 'sub-003',
        capability: 'social_media',
      }),
      final: false,
    })}\n`,
  );

  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'hitl_request',
        prompt: 'Which account should I scrape?',
        source_agent: 'instagram-scraper',
      }),
      final: false,
    })}\n`,
  );

  // We must also send a top-level awaiting_input event so the SSE hook
  // does not close the stream (only result/cancelled/failed are terminal).
  // The stream stays open to simulate waiting for user input.
  // Trailing \n ensures the last SSE event is terminated with \n\n
  return lines.join('\n') + '\n';
}

/** Build SSE with agent result that has a non-orchestrator agent_id at the top level */
function buildNamedAgentResultSSE(taskId: string): string {
  return `data: ${JSON.stringify({
    type: 'result',
    agent_id: 'knowledge',
    result: JSON.stringify({
      output: 'Here are the search results for your query.',
      agent_id: 'knowledge',
      metadata: { agent_id: 'knowledge', duration_ms: 1500 },
    }),
  })}\n\n`;
}

/** Build SSE with duplicate join events for dedup testing */
function buildDuplicateJoinSSE(taskId: string): string {
  const lines: string[] = [];

  // First join
  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_joined',
        agent_id: 'analyzer',
        sub_task_id: 'sub-004',
      }),
      final: false,
    })}\n`,
  );

  // Duplicate join (same agent)
  lines.push(
    `data: ${JSON.stringify({
      task_id: taskId,
      agent_id: 'orchestrator',
      chunk: JSON.stringify({
        type: 'agent_joined',
        agent_id: 'analyzer',
        sub_task_id: 'sub-004',
      }),
      final: false,
    })}\n`,
  );

  lines.push(
    `data: ${JSON.stringify({
      type: 'result',
      result: 'Done.',
    })}\n`,
  );

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────

async function goToFreshChat(page: import('@playwright/test').Page, sseBody: string) {
  await mockBaseRoutes(page);
  await mockDispatch(page, TASK_ID);
  await mockSSEStream(page, TASK_ID, sseBody);
  await mockTaskResult(page, TASK_ID, {
    task_id: TASK_ID,
    status: 'completed',
    result: 'Task completed.',
  });
  await page.addInitScript((key: string) => {
    localStorage.removeItem(key);
    localStorage.removeItem('kubex-active-task');
  }, CHAT_MESSAGES_KEY);
  await page.goto('/chat');
  await page.waitForSelector('[data-testid="message-input"]');
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  const input = page.getByTestId('message-input');
  await input.fill(text);
  await page.click('button:has-text("Send")');
}

// ── Tests ──────────────────────────────────────────────────────────

test.describe('Conversation Participants', () => {
  test('shows system message when agent joins and leaves', async ({ page }) => {
    await goToFreshChat(page, buildParticipantSSE(TASK_ID));
    await sendMessage(page, 'Test agent join/leave');

    // Wait for the result bubble to confirm SSE processing is complete
    await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 10000 });

    // Enable system messages to see them
    await page.click('[data-testid="system-messages-toggle"]');

    // Check for join system message
    const systemMessages = page.locator('[data-testid="system-message"]');
    const allSystemTexts = await systemMessages.allTextContents();
    const joinMsg = allSystemTexts.find((t) => t.includes('knowledge joined the chat'));
    expect(joinMsg).toBeTruthy();

    // Check for leave system message
    const leaveMsg = allSystemTexts.find((t) => t.includes('knowledge left the chat'));
    expect(leaveMsg).toBeTruthy();
    // Should NOT have failure suffix for resolved status
    expect(leaveMsg).not.toContain('task failed');
  });

  test('shows failure suffix when agent leaves with failed status', async ({ page }) => {
    await goToFreshChat(page, buildFailedLeaveSSE(TASK_ID));
    await sendMessage(page, 'Test failed leave');

    await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="system-messages-toggle"]');

    const systemMessages = page.locator('[data-testid="system-message"]');
    const allTexts = await systemMessages.allTextContents();

    const joinMsg = allTexts.find((t) => t.includes('scraper joined the chat'));
    expect(joinMsg).toBeTruthy();

    const leaveMsg = allTexts.find((t) => t.includes('scraper left the chat'));
    expect(leaveMsg).toBeTruthy();
    expect(leaveMsg).toContain('task failed');
  });

  test('HITL prompt shows source agent attribution', async ({ page }) => {
    // Custom setup: use mockTaskResult404 so the fallback poll doesn't clear HITL state
    await mockBaseRoutes(page);
    await mockDispatch(page, TASK_ID);
    await mockSSEStream(page, TASK_ID, buildHITLAttributionSSE(TASK_ID));
    // Mock task result as "still running" (pending) so fallback doesn't clear HITL
    await page.route(`${GATEWAY}/tasks/${TASK_ID}/result`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: TASK_ID, status: 'pending' }),
      });
    });
    await page.addInitScript((key: string) => {
      localStorage.removeItem(key);
      localStorage.removeItem('kubex-active-task');
    }, CHAT_MESSAGES_KEY);
    await page.goto('/chat');
    await page.waitForSelector('[data-testid="message-input"]');

    await sendMessage(page, 'Scrape an account');

    // The prompt text should be visible in the HITL prompt component (wait for HITL to appear)
    await expect(page.locator('p:text-is("Which account should I scrape?")')).toBeVisible({ timeout: 10000 });

    // HITL prompt should show source agent attribution in the header
    await expect(page.getByText('instagram-scraper — Input Required')).toBeVisible();
  });

  test('result bubbles show agent name as sender badge', async ({ page }) => {
    await goToFreshChat(page, buildNamedAgentResultSSE(TASK_ID));
    await sendMessage(page, 'Search for information');

    const resultBubble = page.locator('[data-testid="result-bubble"]');
    await expect(resultBubble).toBeVisible({ timeout: 10000 });

    // Agent badge should show the agent name
    const agentBadge = resultBubble.locator('[data-testid="agent-badge"]');
    await expect(agentBadge).toBeVisible();
    await expect(agentBadge).toContainText('knowledge');
  });

  test('deduplicates join events for the same agent', async ({ page }) => {
    await goToFreshChat(page, buildDuplicateJoinSSE(TASK_ID));
    await sendMessage(page, 'Test dedup');

    await expect(page.locator('[data-testid="result-bubble"]')).toBeVisible({ timeout: 10000 });
    await page.click('[data-testid="system-messages-toggle"]');

    const systemMessages = page.locator('[data-testid="system-message"]');
    const allTexts = await systemMessages.allTextContents();

    // Should only have ONE join message for analyzer (not two)
    const joinMessages = allTexts.filter((t) => t.includes('analyzer joined the chat'));
    expect(joinMessages.length).toBe(1);
  });
});
