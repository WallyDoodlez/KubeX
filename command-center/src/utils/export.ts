// ── Export utilities ─────────────────────────────────────────────────
// These functions create a temporary anchor element and trigger a browser
// download. No server round-trip required — data is serialized client-side.

// Minimal interface so export.ts stays decoupled from types.ts
interface ExportableChatMessage {
  id: string;
  role: 'user' | 'result' | 'error' | 'system' | string;
  content: string;
  timestamp: Date;
  task_id?: string;
}

/**
 * Convert a chat message array to a formatted Markdown string.
 * - user messages → blockquotes with timestamp
 * - result messages → heading with task ID + fenced code block
 * - error messages → warning heading + content
 * - system messages → italic paragraph
 */
export function convertToMarkdown(messages: ExportableChatMessage[]): string {
  const lines: string[] = ['# Chat Export\n'];

  for (const msg of messages) {
    const ts = msg.timestamp instanceof Date
      ? msg.timestamp.toISOString()
      : String(msg.timestamp);

    switch (msg.role) {
      case 'user':
        lines.push(`> **User** · ${ts}`);
        lines.push(`> ${msg.content.replace(/\n/g, '\n> ')}`);
        lines.push('');
        break;

      case 'result': {
        const heading = msg.task_id ? `Result — ${msg.task_id}` : 'Result';
        lines.push(`## ${heading}`);
        lines.push(`*${ts}*`);
        lines.push('');
        lines.push('```');
        lines.push(msg.content);
        lines.push('```');
        lines.push('');
        break;
      }

      case 'error':
        lines.push(`## ⚠️ Error`);
        lines.push(`*${ts}*`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
        break;

      case 'system':
        lines.push(`*[System · ${ts}] ${msg.content}*`);
        lines.push('');
        break;

      default:
        lines.push(`**${msg.role}** · ${ts}`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Download a chat message array as a formatted Markdown file.
 * @param messages  Array of chat messages
 * @param filename  Filename without extension (extension is appended automatically)
 */
export function exportAsMarkdown(messages: ExportableChatMessage[], filename: string): void {
  const md = convertToMarkdown(messages);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  triggerDownload(blob, `${filename}.md`);
}

/**
 * Download arbitrary data as a JSON file.
 * @param data   Any JSON-serializable value
 * @param filename  Filename without extension (extension is appended automatically)
 */
export function exportAsJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(blob, `${filename}.json`);
}

/**
 * Download a table as a CSV file.
 * @param rows      Array of row objects; each value is stringified to a cell
 * @param headers   Column headers in order — must match the keys passed to rowMapper
 * @param rowMapper  Maps a row object to an ordered array of cell values
 * @param filename   Filename without extension (extension is appended automatically)
 */
export function exportAsCSV<T>(
  rows: T[],
  headers: string[],
  rowMapper: (row: T) => (string | number | boolean | null | undefined)[],
  filename: string,
): void {
  const csvLines: string[] = [headers.map(escapeCSVCell).join(',')];

  for (const row of rows) {
    const cells = rowMapper(row).map((v) => escapeCSVCell(String(v ?? '')));
    csvLines.push(cells.join(','));
  }

  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filename}.csv`);
}

// ── Internals ────────────────────────────────────────────────────────

function escapeCSVCell(value: string): string {
  // RFC 4180: wrap in double-quotes if the value contains a comma, double-quote, or newline.
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke after a tick to allow the download to start
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
