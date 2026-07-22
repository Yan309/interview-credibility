# Agent Operations Guide

How this project is set up to be worked on with Claude Code: the file-based operating
loop, and the skills, subagents, hooks and permissions that support it.

**Audience:** whoever picks this module up — including a future session with no memory
of how it got here.

---

## 1. The operating model

The project uses **file-based planning**: durable state lives in markdown on disk, not
in a conversation that ends. This is the pattern Manus popularised — a plan file, a
notes file, and the deliverable — run as a `read → decide → act → update` cycle.

The reason it matters here is specific. This is a 24-hour build whose hardest phase
(P4 calibration) produces findings rather than code. Those findings — a threshold that
worked, a lighting condition that failed, a browser that behaved differently — are
worthless if they live only in chat history.

### The four files

| File | Role | Written by |
|---|---|---|
| [PRD.md](../PRD.md) | Requirements and decisions. Changes rarely. | Human, deliberately |
| [TASKS.md](../TASKS.md) | The board. Current state of the work. | Every session |
| [NOTES.md](../NOTES.md) | Durable findings that outlive a conversation. | Append-only |
| [docs/test-matrix.md](test-matrix.md) | Empirical results for P4–P6 gates. | During `/tune` |

[CLAUDE.md](../CLAUDE.md) sits above these: always-loaded project facts and invariants.
Keep it short. Anything that grew into a procedure belongs in a skill, where it costs
nothing until invoked.

### The cycle

1. **Read** — `SessionStart` hook injects the board state automatically.
2. **Decide** — pull one ticket via `/board`. One at a time.
3. **Act** — the ticket's `IC-nn` appears in the source as `TODO(IC-nn)`.
4. **Update** — move the ticket, record findings, close out via `/board`.

---

## 2. Skills

Four skills, in `.claude/skills/<name>/SKILL.md`. All follow the
[Agent Skills](https://agentskills.io) open standard.

| Skill | Invocation | Why it exists |
|---|---|---|
| `/board` | Either | The read-decide-act-update cycle, made explicit |
| `/tune` | **Human only** | Calibration needs a person in front of a camera |
| `/phase-gate` | Either | Phases are sequential; skipping a gate costs twice |
| `detection-domain` | **Claude only** | Reference material, not an action |

### Invocation control — the part worth understanding

Two frontmatter fields decide who can trigger a skill, and choosing wrongly is the
most common way a skill setup goes bad:

```yaml
disable-model-invocation: true   # only a human can invoke it
user-invocable: false            # only Claude can invoke it
```

`/tune` sets `disable-model-invocation: true` because it requires someone physically
present with a camera. Claude deciding to start a calibration session on its own is
pure waste — it cannot do the one thing the session needs.

`detection-domain` sets `user-invocable: false` because there is nothing for a human to
"run". It is background knowledge that should load when Claude edits detection logic,
and cluttering the `/` menu with it helps nobody.

The default — neither field set — means both can invoke, which is right for `/board`
and `/phase-gate`.

### Pre-approved tools

`allowed-tools` grants tools without a permission prompt for the turn that invokes the
skill, and the grant clears on your next message:

```yaml
allowed-tools: Read Grep Edit
```

`/phase-gate` uses this to run `npm test` and `npm run typecheck` without prompting,
since a gate check that stops to ask permission twice is a gate check nobody runs.

> **Trust note:** project skills in `.claude/skills/` take effect after you accept the
> workspace trust dialog. A skill can grant itself broad tool access via
> `allowed-tools`, so review them before trusting a repo — including these.

---

## 3. Agent roster

Seven agents in `.claude/agents/*.md`, structured as a lead plus phase specialists. Each
runs in its own context window and returns only a summary.

```
                        orchestrator  (opus — decides, never implements)
                              │
      ┌──────────────┬────────┴────────┬──────────────┬──────────────┐
      ▼              ▼                 ▼              ▼              ▼
pipeline-        harness-        calibration-    integration-   [review & research]
engineer         engineer          analyst          writer       detection-reviewer
  P1–P2            P3               P4–P6            P7          mediapipe-researcher
```

### The lead

**`orchestrator`** — `Read, Grep, Glob, Edit, Agent, Bash, PowerShell` · opus

Reads the board, checks gates and dependencies, delegates one ticket at a time, routes
`src/core` changes to review, and updates TASKS.md when work returns. It has `Edit` for
the board and `Agent` to delegate, but no ability to touch `src/` — if it starts
implementing, it has taken someone else's ticket.

Nested delegation works: a subagent can spawn subagents as of Claude Code v2.1.172,
provided `Agent` is in its `tools` list. Omit `Agent` and an agent cannot delegate at
all — which is exactly why the specialists below mostly don't have it.

Model is opus deliberately. Its entire output is judgment — what to work on, whether a
gate is met, when to escalate — and that is the wrong place to economise.

### Phase specialists

| Agent | Phase | Tools | Owns |
|---|---|---|---|
| `pipeline-engineer` | P1–P2 | Write, Edit, Bash, **Agent** | Camera, MediaPipe, sample loop, overlay |
| `harness-engineer` | P3 | Write, Edit, Bash | Prompt, countdown, timeout UI, demo controls |
| `calibration-analyst` | P4–P6 | Write, Edit, Bash | Protocols, matrix analysis, `DEFAULT_CONFIG` |
| `integration-writer` | P7 | Write, Edit | README, API docs, handoff |

`pipeline-engineer` has `Agent` so it can call `mediapipe-researcher` without routing a
docs question back through the lead. The others don't need it.

**`calibration-analyst` cannot run its own tests.** P4–P6 need a person in front of a
camera. The agent prepares protocols, analyses returned observations, and records
results — and is instructed never to write a matrix result it did not receive from a
human. A matrix filled with plausible outcomes is worse than an empty one: it retires
the question without answering it.

### Review and research

**`mediapipe-researcher`** — `WebSearch, WebFetch, Read, Grep, Glob` · sonnet

Read-only by construction. No `Edit` or `Write`, so it cannot act on what it finds. The
MediaPipe and WebRTC docs are large and get referenced once; reading them inline burns
context Phase 4 needs. Instructed to distinguish verified from inferred — a confidently
wrong API detail costs more than an admitted unknown.

**`detection-reviewer`** — `Read, Grep, Glob, Bash, PowerShell` · sonnet · preloads `detection-domain`

Reviews `src/core` against the invariants. Ordinary code review misses these because the
failures aren't bugs in the usual sense: the code is correct and the outcome is unjust.
**Run before closing any ticket touching the state machine, scorer, quality monitor, or
config defaults.**

### When not to delegate

Delegation costs a cold start — the agent re-derives context you already have. For a
single-file edit, a one-line fix, or a question about this repo, doing it directly is
faster and cheaper. The roster earns its keep on context-heavy work: reading large docs,
sweeping many files, or reviewing against a checklist.

### Frontmatter reference

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Lowercase and hyphens. Hooks receive it as `agent_type` |
| `description` | Yes | Drives delegation — write it as *when to use this* |
| `tools` | No | Inherits all if omitted. **Omitting is how a "read-only" agent quietly gets Write** |
| `model` | No | `sonnet`, `opus`, `haiku`, `fable`, full ID, or `inherit` |
| `skills` | No | Preloads full skill content at startup |
| `memory` | No | `user`, `project`, or `local` — cross-session learning |
| `isolation` | No | `worktree` for an isolated repo copy |
| `effort`, `background`, `color`, `hooks` | No | See docs |

---

## 4. Hooks

Two, in [.claude/settings.json](../.claude/settings.json). Both are deliberately cheap —
a hook that runs on every turn and takes three seconds is a hook someone disables.

### `SessionStart` → inject board state

```json
{ "type": "command", "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/session-context.mjs"] }
```

Reads TASKS.md and injects In Progress, next up, and open questions via
`hookSpecificOutput.additionalContext`. This is the **read** step of the cycle,
automated — without it, every session re-derives where the work stands.

Fails silent by design. A broken hook must never stop a session from starting.

### `PostToolUse` (`Edit|Write`) → privacy invariant

```json
{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-core.mjs"] }] }
```

Blocks network egress (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) in
`src/core`. Exits 2, which blocks and feeds stderr back as an error.

This invariant is the entire basis for claiming no candidate-video retention
obligation. It needs a mechanical check, not a code-review habit — habits lapse at 2am
in hour 19 of a 24-hour build. The script strips comments first, so a doc comment
naming `fetch()` does not trip it, and scopes to `src/core` only since `src/demo`
never ships.

### Windows note

Hook commands here use `node` with `args` (exec form) rather than shell pipelines with
`jq`. The Claude Code docs show `jq`-based examples, which are not portable to a
Windows box — `jq` is usually absent, and PowerShell tokenises differently. Node is
already a project dependency, so the scripts run identically everywhere.

### Hooks deliberately *not* configured

| Candidate | Why not |
|---|---|
| `Stop` → run full test suite | Runs on every turn end. Real cost, and `npm test` is already fast to invoke on demand |
| `PostToolUse` → `tsc --noEmit` on every edit | ~3s per edit. Left to `/phase-gate` and CI |
| `PreToolUse` → block video commits | Permission `deny` rules cover it more simply |
| `UserPromptSubmit` → inject board state | Duplicates `SessionStart` on every message |

The full event list is large — `PreToolUse`, `PostToolUse`, `PermissionRequest`,
`SubagentStart/Stop`, `PreCompact`, `ConfigChange`, `TaskCreated`, and more. Most are
not worth wiring for a 24-hour build. Add one when a specific failure recurs, not
speculatively.

---

## 5. Permissions

In `.claude/settings.json` under `permissions`. Rules use `Action(pattern)`, where `*`
matches one path segment and `**` matches recursively. **Permission rules merge across
scopes** rather than overriding — unlike every other setting.

### Precedence

| Scope | File | Shared |
|---|---|---|
| Managed | IT-deployed policy | Org-wide |
| Local | `.claude/settings.local.json` | No — gitignored |
| Project | `.claude/settings.json` | **Yes — commit this** |
| User | `~/.claude/settings.json` | No |

This repo has both: `settings.json` (deliberate, shareable) and a pre-existing
`settings.local.json` holding auto-accumulated approvals from earlier sessions. The
local file is machine-specific noise; the project file is the intentional config.

### What is configured

**Allow** — the loop you run constantly: `npm test`, `npm run typecheck`,
`npm run build`, `npm run dev`, reads and writes under `src/`, `tests/`, `docs/`, and
docs fetches from `code.claude.com` and Google's MediaPipe domains.

Both `Bash(...)` and `PowerShell(...)` forms are listed. This environment has both
tools, and a rule for one does not cover the other.

**Ask** — `package.json` (dependency changes deserve a beat), `PRD.md` (requirements
should not drift silently), and `npm install`.

**Deny** — the ones that matter:

```json
"deny": [
  "Read(./fixtures/video/**)",
  "Write(./fixtures/video/**)",
  "Read(./.env)",
  "Bash(git add *.webm)",
  "Bash(curl:*)"
]
```

`fixtures/video/**` is denied for both read and write because that is where test
footage of real people would land. It is gitignored too — belt and braces, since the
cost of leaking candidate video is not symmetric with the cost of an extra rule.

### Not enabled: `defaultMode: "auto"`

Auto mode uses a background classifier to approve safe actions. Tempting for a fast
build, but this project's whole subject is a system that must not act wrongly against a
candidate. Keeping approvals explicit while the invariants are still being established
is the consistent choice. Revisit at P7.

---

## 6. MCP servers

**Short answer: none are required.** This is worth stating plainly, because the reflex on
a new project is to wire up servers before finding out whether anything needs them.

Everything this project does — filesystem, search, npm, git, and driving the harness in a
browser — is covered by built-in tools. Claude Code already ships browser control
(navigate, click, read the accessibility tree, read console and network), which is enough
to exercise the demo harness and read its event log.

### The one genuine gap

| Server | Fills | Ticket |
|---|---|---|
| [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) | CPU profiling and throttling | IC-39 |

IC-39 requires measuring detection cost while a live voice session runs, and IC-20's gate
is ≥10fps sustained. The built-in browser tools can drive the page but cannot capture a
performance trace. `chrome-devtools-mcp` provides `performance_start_trace` /
`performance_stop_trace` and `emulate_cpu`, which turns "it felt smooth" into a number.

Install it when you reach P7, not before. The rest of the build does not need it.

### Worth it later, not now

- **GitHub MCP** — when this module starts landing PRs against the interview app repo.
  Today there is no repo and no remote. The `gh` CLI covers the interim.
- **Nothing for the detection work itself.** No MCP server helps with face detection,
  threshold tuning, or the state machine. That work is code and physical testing.

### Not appropriate here

Anything that would move candidate video or frame data off the machine. The privacy
invariant is the basis for this feature having no video-retention obligation; an MCP
server that uploads frames for analysis would silently void it. If someone proposes one,
that is a product and legal decision, not a tooling decision.

---

## 7. Human intervention

The parts no agent can do. Ordered by how badly the project stalls without them.

### Blocking — work stops until a human acts

| # | What | Blocks | Why no agent can do it |
|---|---|---|---|
| 1 | **`git init`** and first commit | Everything | Not a repo yet. Checkpointing and rollback both depend on it, and P4 is exactly the work you'll want to undo |
| 2 | **Accept the workspace trust dialog** | Skills, permissions, hooks | Security boundary — it exists precisely so an agent cannot self-authorise |
| 3 | **Answer: does the host app already hold a `MediaStream`?** | IC-11, all of P1 | Requires knowledge of a codebase not present here. Guessing produces a plausible wrong architecture |
| 4 | **All physical camera testing** (P4, P5, P6) | Three phases | Someone must be in front of a camera, in specific lighting, wearing a mask, holding a photo |

### Physical testing — the biggest irreducible block

Roughly half the remaining work needs a body in a chair. `calibration-analyst` prepares
and analyses; it cannot perform.

- **P4 soak** — a 10-minute natural-movement session. Cannot be simulated: the whole
  point is real, unscripted human movement.
- **Case 5.3, low light with dark skin tone** — needs **multiple real people with
  different skin tones.** This is the single most skippable item on the board and the most
  costly to skip: a threshold tuned on one skin tone produces false absences that land
  disproportionately on candidates who did nothing wrong. It cannot be inferred from 5.4
  passing, and one person cannot cover it.
- **Masks** (6.1–6.3) — physical surgical and cloth masks.
- **Spoofs** (6.4–6.6) — a printed photo, tape, a phone screen.
- **Camera lifecycle** (7.1–7.4) — denying permission, unplugging the camera, occupying it
  with another app, closing the laptop lid.

### Product and legal decisions

An agent can lay out the trade-off; it cannot make these calls.

| Decision | Blocks | Why it's yours |
|---|---|---|
| Return-prompt wording | IC-25 | Read by someone about to lose an interview. Needs a human who owns candidate experience |
| Retention policy for the integrity summary | IC-41 | Legal exposure |
| Who reads the summary — recruiter or automated scoring | IC-42 | Changes what gets built |
| **Sign-off on auto-ending interviews** | Ship | The module reports; someone must own the decision that a report ends a session |
| **Any change to an invariant** | — | Privacy, never-terminate, fairness. All four are decisions, not refactors |

### Verification a human should not delegate

- **Spot-check that empirical gates were actually met.** The failure mode this whole
  module guards against — a system wrongly concluding something about a person — is
  available to the process building it. Agents mark tickets done; only a human knows
  whether the 10-minute soak really happened.
- **Review project skills before trusting the repo.** A skill can grant itself broad tool
  access through `allowed-tools`. That includes the four in this repo.

---

## 8. Setup checklist

Everything below is already in the repo. This is what to verify, in order:

- [ ] `git init` — **not yet a repo.** Do this before P1. Checkpointing and review
      tooling both assume version control, and P4 calibration is exactly what you want
      to be able to roll back.
- [ ] Accept the workspace trust dialog so project skills and permissions activate.
- [ ] Confirm the `SessionStart` hook fires — a new session should open with board state.
- [ ] Confirm the privacy hook blocks — add `fetch('/x')` to a `src/core` file and
      check it is rejected. **Then remove it.**
- [ ] Commit `.claude/settings.json`, `.claude/skills/`, `.claude/agents/`,
      `.claude/hooks/`. Do **not** commit `.claude/settings.local.json`.
- [ ] Add `.claude/settings.local.json` to `.gitignore`.

## 9. Adding to this setup

Add a **skill** when the same multi-step procedure gets pasted into chat twice, or when
a CLAUDE.md section turns into a procedure. Skills cost nothing until invoked.

Add a **subagent** when the same kind of side task keeps flooding the main context, or
when a task should run with restricted tools.

Add a **hook** when a specific mistake has actually recurred. Hooks run unconditionally
and their cost compounds — speculative hooks are how a fast setup becomes a slow one.

Add a **permission rule** when the same prompt appears repeatedly. Prefer narrow rules;
`Bash(npm run test:*)` over `Bash(npm:*)`.

---

## Sources

- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
