---
name: phase-gate
description: Verify a phase's exit criteria before advancing to the next one. Use when a phase looks finished, or before starting a new phase.
allowed-tools: Read Grep Glob Bash(npm test:*) Bash(npm run typecheck:*) PowerShell(npm test*) PowerShell(npm run typecheck*)
---

# Phase gate

Checks that a phase in [TASKS.md](../../../TASKS.md) is actually done before the next
one starts. Phases are sequential; starting P5 on top of an unfinished P4 means
recalibrating everything twice.

## Procedure

1. Read the phase table in TASKS.md and take its **Gate to exit** column literally.
2. List every ticket in that phase and its current column. Any ticket not in Done
   means the gate is not met — say which, and stop.
3. Run the mechanical checks: `npm test`, `npm run typecheck`.
4. For empirical gates (P4, P5, P6), open
   [docs/test-matrix.md](../../../docs/test-matrix.md) and confirm the relevant rows
   have a recorded result. **A blank result is a fail, not an assumption.**
5. Grep the source for `TODO(IC-nn)` markers belonging to the phase. A live TODO for a
   ticket marked Done is a bookkeeping error worth catching now.

## Report

State plainly: gate met, or gate not met and exactly what is outstanding.

Do not soften this. The phases most likely to be waved through are P4 and P5, and
those are precisely the ones whose failures show up later as false alerts against
real candidates — the expensive kind of bug, because it lands on someone who did
nothing wrong.

## Phase-specific traps

- **P4** — the gate is "zero prompts in a 10-minute natural session." A shorter or
  artificially still session does not count.
- **P5** — case 5.3 (low light, dark skin tone) is a fairness case. It gets run, not
  inferred from 5.4 passing.
- **P6** — check the false-positive case (6.7, still person not flagged) before the
  catch cases. A gate met only on spoof detection is not met.
- **P7** — "integration-ready" means someone else can mount it from the README alone.
  If the notes assume this conversation, it is not ready.
