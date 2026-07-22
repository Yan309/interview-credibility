#!/usr/bin/env node
/**
 * SessionStart hook — injects the current board state into context.
 *
 * This is the "read the plan first" step of the file-based operating loop. Without
 * it, every new session starts by re-deriving where the work stands from scratch.
 *
 * Contract: stdout must be ONLY valid JSON. Exit 0 always — a broken hook must
 * never stop a session from starting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/\n#{1,3} /);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** Pull `| IC-nn | Title | ... |` rows out of a markdown block. */
function tickets(block, limit = Infinity) {
  return block
    .split('\n')
    .filter((line) => /^\|\s*IC-\d+/.test(line))
    .map((line) => {
      const cells = line.split('|').map((c) => c.trim());
      return `${cells[1]} — ${cells[2]}`;
    })
    .slice(0, limit);
}

try {
  const board = readFileSync(join(projectDir, 'TASKS.md'), 'utf8');

  const inProgress = tickets(section(board, '### 🚧 In Progress'));
  const todo = tickets(section(board, '### 🔜 To Do'), 5);
  const blocked = section(board, '## Blocked / needs an answer')
    .split('\n')
    .filter((line) => /^\|\s*\d/.test(line))
    .map((line) => line.split('|')[2]?.trim())
    .filter(Boolean);

  const lines = ['Board state (from TASKS.md):', ''];

  lines.push(
    inProgress.length > 0
      ? `In Progress:\n${inProgress.map((t) => `  - ${t}`).join('\n')}`
      : 'In Progress: nothing. Ask which ticket to pull before starting work.',
  );

  if (todo.length > 0) {
    lines.push('', `Next up:\n${todo.map((t) => `  - ${t}`).join('\n')}`);
  }
  if (blocked.length > 0) {
    lines.push('', `Open questions:\n${blocked.map((q) => `  - ${q}`).join('\n')}`);
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lines.join('\n'),
      },
    }),
  );
} catch {
  // No board yet, or unreadable. Silence is correct — do not derail the session.
}

process.exit(0);
