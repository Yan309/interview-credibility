---
name: board
description: Read, advance, or update the IC kanban board in TASKS.md. Use when pulling a ticket, moving one between columns, closing one out, or asking what to work on next.
allowed-tools: Read Edit Grep
---

# Board

The read-decide-act-update loop over [TASKS.md](../../../TASKS.md). The board is the
source of truth for what is being worked on — not the conversation, which does not
survive a session.

## Pull a ticket

1. Read TASKS.md. Confirm the In Progress column is empty. **If something is already
   in progress, stop and say so** rather than starting a second thing.
2. Check the ticket's `Depends on` column. If a dependency is not in Done, say which
   one blocks it and stop.
3. Check the Blocked table. If the ticket appears there, it needs an answer from a
   human first — surface the question, do not guess an answer and proceed.
4. Move the row from To Do to In Progress.

## Close a ticket

1. Verify the acceptance criteria in the Ticket detail section, if it has any. State
   which ones you actually verified and how. Do not mark AC met on inspection alone
   when the criterion is empirical — those need a real run.
2. Move the row to Done with its phase.
3. Remove or update the matching `TODO(IC-nn)` in the source. A stale TODO pointing at
   a closed ticket is worse than no TODO.
4. If the work produced findings worth keeping — a threshold value, a browser quirk, a
   condition that fails — append them to [NOTES.md](../../../NOTES.md). Calibration
   results go in [docs/test-matrix.md](../../../docs/test-matrix.md) instead.

## Add a ticket

Next free `IC-nn`. Put it in the phase it belongs to, not the phase currently active.
Include an estimate and its dependencies. If it turned up while doing other work,
say so in NOTES.md — discovered work is a signal about the plan's accuracy.

## Rules

- Never mark a ticket Done because the code looks right. Phases 4, 5 and 6 gate on
  empirical results; those need a run and a recorded outcome.
- Never silently re-scope a ticket. If it turns out to be three tickets, split it and
  say so.
- Keep the phase table's estimates honest. If P4 has burned its budget, update it —
  the number is only useful while it reflects reality.
