/**
 * Smart agent result extraction and formatting.
 *
 * Handles double-encoded JSON payloads from SSE events and poll fallbacks,
 * unwrapping nested result/output fields and converting known object shapes
 * to readable markdown.
 */

export interface ExtractedResult {
  text: string;
  agentId?: string;
  durationMs?: number;
}

/**
 * Extract readable text content from an agent result data object.
 *
 * Priority chain:
 *  1. `data.output`
 *  2. `data.result`
 *  3. `data` itself
 *
 * Double-decode: if the extracted value is a string, try JSON.parse().
 * If the inner object has `.result` or `.output` (string), unwrap further.
 *
 * Known fields are converted to markdown; unknown objects fall back to
 * a fenced JSON code block.
 */
export function extractResultContent(data: Record<string, unknown>): ExtractedResult {
  // --- Determine raw value using priority chain ---
  let raw: unknown;
  if (data.output !== undefined) {
    raw = data.output;
  } else if (data.result !== undefined) {
    raw = data.result;
  } else {
    raw = data;
  }

  // --- Metadata extraction (top-level envelope) ---
  let agentId: string | undefined = typeof data.agent_id === 'string' ? data.agent_id : undefined;
  let durationMs: number | undefined;

  // --- Double-decode ---
  let value = raw;

  // First parse attempt
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // not JSON — keep as string
    }
  }

  // Unwrap inner .result
  if (isPlainObject(value) && 'result' in (value as Record<string, unknown>)) {
    const inner = (value as Record<string, unknown>).result;
    // Extract metadata before unwrapping
    extractMetadata(value as Record<string, unknown>);
    value = inner;
  }

  // Unwrap inner .output (string → try parse)
  if (isPlainObject(value) && 'output' in (value as Record<string, unknown>)) {
    const output = (value as Record<string, unknown>).output;
    if (typeof output === 'string') {
      try {
        value = JSON.parse(output);
      } catch {
        value = output;
      }
    } else {
      value = output;
    }
  }

  // Second parse attempt (after unwrapping)
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // not JSON — keep as string
    }
  }

  // Extract metadata from the unwrapped value
  if (isPlainObject(value)) {
    extractMetadata(value as Record<string, unknown>);
  }

  // --- Convert to readable text ---
  const text = formatValue(value);

  return { text, agentId, durationMs };

  // --- Helpers (closure over agentId/durationMs) ---

  function extractMetadata(obj: Record<string, unknown>) {
    // agent_id at top level of inner object
    if (!agentId && typeof obj.agent_id === 'string') {
      agentId = obj.agent_id;
    }
    // metadata.agent_id
    if (!agentId && isPlainObject(obj.metadata)) {
      const meta = obj.metadata as Record<string, unknown>;
      if (typeof meta.agent_id === 'string') {
        agentId = meta.agent_id;
      }
    }
    // result.agent_id
    if (!agentId && isPlainObject(obj.result)) {
      const res = obj.result as Record<string, unknown>;
      if (typeof res.agent_id === 'string') {
        agentId = res.agent_id;
      }
    }
    // duration_ms
    if (durationMs === undefined && isPlainObject(obj.metadata)) {
      const meta = obj.metadata as Record<string, unknown>;
      if (typeof meta.duration_ms === 'number') {
        durationMs = meta.duration_ms;
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert a value to readable markdown/text.
 */
function formatValue(value: unknown): string {
  // Plain string — use directly
  if (typeof value === 'string') {
    return value;
  }

  // Null/undefined
  if (value === null || value === undefined) {
    return '';
  }

  // Non-object primitives
  if (typeof value !== 'object') {
    return String(value);
  }

  // Object — check for known fields
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof obj.role_summary === 'string') {
    parts.push(obj.role_summary);
  }

  if (Array.isArray(obj.capabilities) && obj.capabilities.length > 0) {
    parts.push(`**Capabilities:** ${obj.capabilities.join(', ')}`);
  }

  if (typeof obj.error === 'string') {
    parts.push(`> **Error:** ${obj.error}`);
  }

  // If we extracted known fields, return them
  if (parts.length > 0) {
    return parts.join('\n\n');
  }

  // Unknown object shape — fenced JSON code block
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}
