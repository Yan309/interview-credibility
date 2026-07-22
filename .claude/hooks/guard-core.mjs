#!/usr/bin/env node
/**
 * PostToolUse hook — enforces the privacy invariant on src/core.
 *
 * The invariant is that no frame, landmark set, or image ever leaves the browser.
 * That is the whole basis for saying this feature has no candidate-video retention
 * obligation, so it needs a mechanical check rather than a code-review habit.
 *
 * Scoped to src/core only. src/demo may do whatever it likes; it never ships.
 *
 * Exit 2 blocks and feeds stderr back to Claude. Exit 0 passes.
 */
import { readFileSync } from 'node:fs';

const EGRESS = [
  { pattern: /\bfetch\s*\(/, name: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, name: 'XMLHttpRequest' },
  { pattern: /\bnew\s+WebSocket\b/, name: 'WebSocket' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, name: 'navigator.sendBeacon' },
  { pattern: /\bnavigator\s*\.\s*clipboard\b/, name: 'navigator.clipboard' },
];

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

const raw = await readStdin();

// Strip a UTF-8 BOM. PowerShell prepends one when piping a string, and JSON.parse
// throws on it. Without this the guard silently fails open on Windows — which is
// the worst possible failure mode for a check like this.
const cleaned = raw.replace(/^﻿/, '').trim();

if (cleaned === '') process.exit(0);

let filePath;
try {
  filePath = JSON.parse(cleaned)?.tool_input?.file_path;
} catch (error) {
  // Never block on a malformed payload — that would wedge every edit. But say so
  // loudly, because a guard nobody knows has stopped working guards nothing.
  process.stderr.write(
    `guard-core: could not parse hook input, privacy check DID NOT RUN (${error.message})\n`,
  );
  process.exit(1);
}

if (!filePath) process.exit(0);

const normalised = filePath.replace(/\\/g, '/');
if (!/\/src\/core\//.test(normalised)) process.exit(0);

let contents;
try {
  contents = readFileSync(filePath, 'utf8');
} catch {
  process.exit(0);
}

// Strip comments so a doc comment naming fetch() does not trip the check.
const code = contents
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const violations = EGRESS.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);

if (violations.length > 0) {
  process.stderr.write(
    `PRIVACY INVARIANT VIOLATED in ${filePath}\n\n` +
      `Found network egress in src/core: ${violations.join(', ')}\n\n` +
      `src/core must never transmit anything. No frame, landmark set, or image may\n` +
      `leave the browser — that is what keeps this feature clear of candidate-video\n` +
      `retention obligations (PRD.md §6.5, CLAUDE.md Invariants).\n\n` +
      `If the host app needs this data, emit an event and let it decide. If the\n` +
      `invariant genuinely needs to change, that is a product and legal decision,\n` +
      `not a refactor — stop and raise it.\n`,
  );
  process.exit(2);
}

process.exit(0);
