# Interview Credibility — Agent Instructions

Browser-side camera presence, absence and liveness detection for live interviews.
[PRD.md](PRD.md) = requirements · [TASKS.md](TASKS.md) = board · [NOTES.md](NOTES.md) = findings
· [docs/AGENT-OPERATIONS.md](docs/AGENT-OPERATIONS.md) = full setup.

## Which agent for what

Delegate by task type. When in doubt, `orchestrator` picks.

| Task | Agent | Phase |
|---|---|---|
| "What should I work on?" · multi-ticket work · unclear scope | `orchestrator` | any |
| Camera, MediaStream, MediaPipe, detection loop, overlay, debug panel | `pipeline-engineer` | P1–P2 |
| Return prompt, countdown, timeout UI, demo harness, config sliders | `harness-engineer` | P3 |
| Threshold tuning, test-matrix rows, `DEFAULT_CONFIG` values, soak analysis | `calibration-analyst` | P4–P6 |
| MediaPipe API shapes, browser compat, WebRTC questions | `mediapipe-researcher` | any |
| Reviewing any change to `src/core` before closing a ticket | `detection-reviewer` | any |
| README, integration notes, public API docs, handoff | `integration-writer` | P7 |

**Do it yourself** — single-file edits, one-line fixes, reading code, answering questions
about this repo. Delegation costs a cold start; it pays off on context-heavy work only.

`/board` pulls and closes tickets · `/phase-gate` checks exit criteria · `/tune` runs a
calibration session (human only).

## Operating loop

Read [TASKS.md](TASKS.md) → work the ticket in **In Progress** (its id appears in code as
`TODO(IC-nn)`) → update the board and log findings. One ticket at a time. If nothing is
In Progress, ask which to pull.

## Invariants

Not preferences. Changing one is a decision, not a refactor.

1. **Nothing leaves the browser.** No `fetch`/`XHR`/`WebSocket`/`sendBeacon` in `src/core`.
   Events carry scalars and timestamps only. A `PostToolUse` hook enforces this.
2. **The module never ends the interview.** `absence:timeout` is a report; the host app decides.
3. **Degraded quality suspends absence escalation.** "Too dark to judge" and "absent" stay
   distinct events and distinct summary fields — a reviewer must always be able to tell
   them apart. Face detection degrades unevenly across skin tones, so this stays a
   fairness constraint.
   **Amended 2026-07-22 (owner decision):** unusable conditions may now terminate via
   `quality:timeout` after `lightingTimeoutMs`. Guard: the clock runs **only** while the
   frame is degraded AND no face is detectable. A visible candidate is never terminated
   for lighting. Do not remove that second condition — see [NOTES.md](NOTES.md).
4. **Liveness is advisory.** Two dead signals minimum, never terminates, never accusatory.
5. **Hysteresis holds.** `presenceRecoverRatio > absenceEnterRatio`; the `resolveConfig`
   guard stays.

## Commands

```bash
npm run dev   # harness at localhost:5173
npm test      # camera-free
npm run typecheck && npm run build
```

Node ≥20.11. Vite pinned to 6.x (Vite 7 needs 20.19+) — do not bump.

## Conventions

- `src/core/` ships and has no UI-framework dependency. `src/demo/` never ships.
- Tests stay camera-free.
- Every stub carries `TODO(IC-nn)`. Keep them in sync with the board.
- Tuned values go into `DEFAULT_CONFIG` **with a comment on how they were derived.**
- Never commit candidate footage. `fixtures/video/` is gitignored and permission-denied.
