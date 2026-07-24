# Working Notes

Durable findings that belong to the project rather than to a conversation. Append,
don't rewrite. Calibration results go in [docs/test-matrix.md](docs/test-matrix.md);
this file is for everything else worth carrying forward.

Format: `## YYYY-MM-DD — topic`, then what was found and what it means for the plan.

---

## 2026-07-21 — Scaffolding decisions

**Vite pinned to 6.x.** Node here is 20.11.1; Vite 7 requires ≥20.19. Bumping Vite
without bumping Node breaks the dev server. Recorded because it will look like an
arbitrary pin later.

**State machine built before the camera layer.** It decides whether an interview ends,
it holds the Phase 4 risk, and it tests without hardware. The camera and MediaPipe
layers are stubs behind real interfaces, so the pipeline shape is already fixed.

**One test failed on first run and the fixture was wrong, not the code.** The
"requires two dead signals" case had been written with zero pose *and* zero motion —
two dead signals, so flagging was correct. Worth remembering during IC-30: it is easy
to construct a liveness fixture that proves the opposite of what it intends.

**Not a git repo yet.** `git init` before P1 — file checkpointing and any review
tooling both assume version control, and the calibration work in P4 is exactly what
you want to be able to roll back.

---

## 2026-07-22 — Agent operations setup

**The privacy hook failed open on first test.** PowerShell prepends a UTF-8 BOM when
piping a string to a process; `JSON.parse` threw on it, the `catch` swallowed the
error, and the guard exited 0 while reporting nothing. It looked like it was working.

Fixed by stripping the BOM and making a parse failure exit 1 with a stderr message
instead of exiting 0 silently. The general lesson is worth keeping: **a guard that
fails open silently is worse than no guard**, because it manufactures confidence. Any
future hook added here should be tested against its violation case, not just its
pass case.

**Hook scripts are node, not shell.** The Claude Code docs use `jq` pipelines, which
are not portable to this Windows box. Node is already a dependency and behaves
identically everywhere.

---

## 2026-07-22 — P1: FaceLandmarker returns no confidence score

**The finding.** `FaceLandmarkerResult` is `{ faceLandmarks, faceBlendshapes,
facialTransformationMatrixes }` — there is **no per-face detection score**. The PRD and
the original `DetectionSample` design assumed one and gated presence on
`confidence >= minFaceConfidence`.

MediaPipe applies `minFaceDetectionConfidence` / `minFacePresenceConfidence` internally
and returns only faces that already passed. A returned face *is* a confident one.

**What changed.** `minFaceConfidence` is now pushed **down** into the model options at
`init()` rather than compared in the state machine, and the detector reports
`confidence: 1` for a returned face, `0` for none. The config knob still means what it
says; it just takes effect one layer earlier.

**Consequence to remember during P4:** for the MediaPipe path the machine's
`confidence >= minFaceConfidence` comparison is now always true when a face is present.
It still does real work for `ScriptedDetector` and the tests. Anyone tuning
`minFaceConfidence` and watching for the machine to behave differently will be confused
unless they know the gate moved. If finer-grained confidence is ever needed, `FaceDetector`
(BlazeFace) *does* return a score — at the cost of a second model, which §5 of the PRD
rejected for CPU reasons.

**Also from this pass:**

- The transformation matrix `data` is **column-major** — element (row, col) is
  `data[col * 4 + row]`. Reading it row-major transposes the rotation and silently swaps
  yaw and pitch. The values still look plausible, which is what makes it dangerous; the
  unit tests pin the convention.
- Gimbal lock at |pitch| ≈ 90° would produce `NaN` yaw/roll, which would poison the pose
  variance and quietly disable the head-pose liveness signal rather than failing loudly.
  Handled explicitly and tested.
- Micro-motion is reset to `null` when a face disappears. Carrying it across an absence
  would make the first frame back read as a huge displacement — i.e. as proof of life.
- **WASM is served locally**, copied from `node_modules` by `npm run sync:wasm` (wired to
  predev/prebuild). An interview that fails because someone else's CDN is unreachable
  fails for a reason the candidate cannot do anything about.
- The `face_landmarker.task` model (~3.7MB) is **not** on npm and must be fetched once via
  `npm run fetch:model`. Deliberately a separate explicit command, not a postinstall hook —
  a build that quietly reaches out to a Google bucket is what this project's privacy
  posture says not to do.

---

## 2026-07-22 — First live run: 9fps was the throttle, not the hardware

GPU delegate loaded successfully on first try. Measured 9fps against a `targetFps` of 10,
which initially reads as "we are 10% short of the gate."

It was not a performance limit. Camera frames arrive on a ~33ms grid; the throttle tested
`elapsed >= 100ms`, which rejects the frame at 100ms and waits for the one at 133ms —
a real ceiling of ~7.5fps regardless of how fast detection runs. Fixed with a 20%
tolerance so a frame landing fractionally early still counts, snapping sampling back onto
the intended cadence.

**Worth remembering for IC-39:** the headline fps number measures the sample loop, not
detection cost. A throttle artefact and a CPU limit look identical from the outside. When
benchmarking, compare against `targetFps` first and only then conclude anything about
load.

---

## 2026-07-22 — The "black preview" was CSS, and a diagnostic lesson

`.prompt { display: grid }` overrides the UA stylesheet's `[hidden] { display: none }`,
because author rules beat UA rules regardless of specificity. Both the return prompt and
the ended overlay were therefore painted at full size from page load, at 86% and 95%
opacity, over the video. The camera, the model and the detection loop were all working
perfectly the entire time.

Fix: `.prompt[hidden] { display: none; }`.

**The diagnostic lesson is the durable part.** The first probe checked `element.hidden`,
saw `true`, and concluded the overlays were not the cause — which sent the investigation
into a wrong hypothesis about GPU/WebGL compositing and cost a full round trip of the
user's time. `element.hidden` reports the attribute; `getComputedStyle(el).display`
reports what the browser actually paints. For any "element not visible / wrongly visible"
question, check computed style, not the property.

Any `hidden` toggle in this project should be paired with a `[hidden]` CSS rule whenever
the element also has an author `display` declaration.

## 2026-07-22 — Mobile is not in the PRD, and that is a gap

Raised by the question "why does delegate selection exist — most candidates are on normal
laptops or phones."

The delegate answer is that it is invisible and automatic (try GPU, fall back to CPU), so
no candidate or integrator ever chooses. But **phones** deserved a real answer and the PRD
does not have one. Concrete consequences found immediately:

- **`facingMode` was unset**, so a phone could hand us the rear camera. Detection would
  then report a confident, sustained absence for a candidate sitting right in front of the
  screen — a false timeout caused entirely by camera selection. Fixed with
  `facingMode: { ideal: 'user' }`.
- Still open: iOS Safari behaviour, sustained-detection battery and thermal throttling,
  orientation changes, and what happens when a phone call interrupts an interview.

PRD §9 assumes a laptop throughout ("mid-range laptop"). If phones are a real interview
surface, that assumption needs revisiting before P5.

---

## 2026-07-22 — DECISION: lighting timeout may end a session (Invariant 3 amended)

**Owner decision.** Asked what should happen when the lighting-recovery countdown expires,
with three options and the fairness tradeoff stated. Chose: **end the interview, same as
absence.**

This amends Invariant 3, which previously said degraded quality must never terminate.
Recorded here rather than absorbed silently, because the original constraint existed for a
reason that has not gone away.

**What was implemented**

- `quality:timeout` event and `lightingTimeoutMs` (default 60s, twice the absence timeout —
  fixing a room takes longer than stepping back into frame).
- Candidate-facing prompt naming the specific condition, with a live countdown.
- `qualityTimedOut` kept **separate** from `timedOut` in the session summary. A session
  ended because a room was dark is a different finding from one ended because the
  candidate left, and collapsing them would misrepresent the candidate.

**The guard, and why it must not be removed**

The clock runs only while the frame is degraded **and** `faceCount === 0`. A candidate who
is still detectable despite poor lighting is never escalated — they are demonstrably
present, so there is nothing to escalate. This was added inside the owner's decision, not
as a hedge against it: it removes the most unfair failure mode (terminating a visible
person over their camera quality) while preserving the intent (unusable feeds must
resolve).

Pinned by `tests/quality-timeout.test.ts`, particularly the "does NOT fire while a face is
still detectable" case. If that test is ever failing, do not adjust it to pass — the guard
is the point.

**Residual risk, for the record.** Camera quality correlates with equipment cost and, via
detector performance, with skin tone. A termination path gated on camera quality will fire
unevenly across candidates even with the guard in place. `lowLightLumaThreshold` (IC-24)
therefore stops being just a tuning value and becomes the control that decides who gets
timed out — it must be calibrated against multiple real people with different skin tones
before this ships, and raising `lightingTimeoutMs` is always safer than lowering it.

---

## 2026-07-22 — Cold-start bug, and the worse one hiding behind it

**Reported:** a session that opens with nobody in frame goes to ABSENT_PENDING and the
timer never fires.

**Cause.** `pendingSince` was set at each call site, and the INITIALIZING path forgot.
The elapsed check then read `this.pendingSince ?? sample.at`, comparing each sample's
timestamp against itself — always zero, so the grace period could never elapse. The
machine sat in ABSENT_PENDING for the whole interview: no prompt, no timeout, no error.

Silent-hang failures are the expensive kind. Nothing in the event stream indicated a
problem, so the module looked healthy while doing nothing.

**Fix.** `transition()` now owns the grace clock, so no call site can omit it, and the
ABSENT_PENDING branch uses `??=` so it self-heals rather than hanging if the clock is ever
missing.

**The second bug, which the first was masking.** Fixing the hang broke the existing
"does not flap at the threshold" test — correctly. The INITIALIZING branch decided
present/absent using `presenceRecoverRatio` (0.6), not `absenceEnterRatio` (0.2). Any
merely-marginal opening reading (~0.5 — a flickering detector, a candidate at an angle,
poor contrast) therefore opened in ABSENT_PENDING. With the clock now running, that
candidate would be prompted and then timed out **while sitting in front of the camera.**

That is worse than the reported bug, and it was invisible because the hang swallowed it.
Initialization now enters ABSENT_PENDING only on `ratio < absenceEnterRatio`; ambiguity at
startup resolves toward present, which is the direction where being wrong is cheap.

**Lesson worth keeping:** when a fix breaks an existing test, check whether the test was
passing *because* of the bug before adjusting either. Here the failing test was the only
thing pointing at the more serious defect, and "fixing" the test would have shipped it.

Regression coverage in `tests/starts-absent.test.ts`, including the case that must NOT
prompt — arriving during the grace period of a cold start.

---

## 2026-07-22 — Deployment: Vercel via Git, and why vercel.json looks bare

**`vercel.json` rejects unknown properties.** Adding `comment` keys to document the header
rules failed validation with `headers[0] should NOT have additional property comment`. JSON
has no comment syntax and Vercel's schema is strict, so the reasoning lives here instead:

- `/mediapipe/wasm/*` and `/models/*` — cached one year, immutable. A first visit downloads
  ~15MB (one WASM variant plus the 3.7MB face model). Without this it repeats on every
  visit, which on a candidate's mobile data is slow and expensive. Both paths are
  version-pinned, so a year is safe.
- `/assets/*` — Vite fingerprints these filenames, so a new build produces new URLs.
- `/` — explicitly `must-revalidate`. If the entry point were cached, a redeploy would
  strand phones on the old build with no way to refresh out of it.

**Deploy via Git integration, not the CLI.** Three CLI attempts failed in sequence:

1. `vercel@39.4.2` — ran on Node 20.11 but its localhost-redirect login was **removed by
   Vercel on 2026-02-26**. Redirected to a changelog page instead of authenticating.
2. `vercel@latest` (56.5.0) — needs Node `^20.19 || >=22.12`; transitive deps (`rolldown`,
   `oxc-transform`, `undici`) broke the install and left no bin shim.
3. `vercel@41.3.2 --future` — device flow started, then failed with `Invalid Compact JWS`.
   Almost certainly a Sept-2025 client against July-2026 servers.

Git integration sidesteps all of it: Vercel builds on their own infrastructure with current
Node, so the local Node version stops mattering. It also auto-deploys on push.

**Lesson:** when a tool's version constraints have already bitten twice, stop looking for a
compatible version and look for a path that does not need the tool. Two of those three
attempts were wasted user time.

---

## 2026-07-24 — Repeated-absence warning system (cohort strikes)

**Requested:** somebody who leaves and returns repeatedly should accrue warnings, with a
per-cohort limit — panel 3, known 5, internal "etc".

**Design.** New `WarningTracker` in src/core, same shape as the other units. Config gains
`cohort: 'panel' | 'known' | 'internal'` and `warningLimits: Record<cohort, number>`
(defaults 3 / 5 / 8 — **internal's 8 is a placeholder; the owner did not give a number,
confirm it**). Two new events: `warning:issued` (advisory, count of limit) and
`warnings:exhausted` (a REPORT — like `absence:timeout`, the host decides whether to end).

**Decisions worth remembering:**

- A strike is counted per **escalated** absence (`absence:started`), not per raw
  look-away. A dip under the grace period never prompted the candidate, so it is not held
  against them. Tested explicitly.
- `warnings:exhausted` fires on the crossing to `count === limit`. So panel (limit 3) means
  the **3rd** absence is the last — 2 warnings shown, then out. If the owner wants "3
  warnings shown, out on the 4th", that is a one-line change in WarningTracker. **Flagged
  to owner.**
- Warnings do **not** reset on a discontinuity (`machine.reset()` for a lid close). A
  laptop sleep is not a strike. They reset only at `beginSession`.
- The limit is read live from the config object, so changing cohort in the tuning panel
  takes effect immediately — same live-mutation pattern the sliders already rely on.
- `qualityTimedOut` / `timedOut` / `warningsExhausted` are three distinct summary fields.
  A reviewer must be able to tell "left too long" from "left too often" from "room too
  dark" — they say different things about the candidate.

## 2026-07-24 — Demo consolidated to a single view

The `?debug=1` split is gone. The instrument view (video + prompts + config + event log +
live summary) is now the only view; the stripped "clean" view was removed at the owner's
request (it had layout bugs and the client wants the metrics). `body.debug` is now set
unconditionally. Consequence: the client sees the config sliders and can move them — an
accepted tradeoff, since the point is for them to see it working and report detail.

---

## 2026-07-24 — Slow "INITIALIZING" on Vercel: measured, and fixed with preload

**Reported:** ~20s stuck on INITIALIZING on the Vercel deploy (longer on phone), but fast
on stop/restart until a refresh.

**Measured against the live deploy** (interview-credibility-mrsg.vercel.app), not guessed:

| Asset | Cold (network) | Cached refetch |
|---|---|---|
| face_landmarker.task | ~7.0s | 38ms |
| vision_wasm_internal.wasm | ~6.6s | 65ms |

- Cache headers ARE live and correct: `public, max-age=31536000, immutable`. ✓
- Brotli on (`content-encoding: br`), Vercel edge `x-vercel-cache: HIT`. ✓
- Cached refetch 38–65ms → **browser caching works.** Caching was never the problem.

So the cost is the one-time download of ~15MB (decompressed; ~7–8MB on the wire) plus WASM
compile + GPU init, all inside `detector.init()`. Local is instant only because the files
come off disk. The sandbox link measured 0.4 Mbps, which is why cold was ~7s each there; a
weak phone connection is the same story → "even longer on phone." The restart-fast /
refresh-slow pattern is explained: the compiled model lives in page memory (restart reuses
it), and a refresh discards it — the download is then cache-served but the compile/init
recurs.

**Fix: preload during the landing screen.** `detector.init()` is now idempotent and
concurrency-deduped (an in-flight call is shared; a completed one returns instantly;
`close()` clears the cached promise). `PresenceRuntime.warmUp()` runs it without the camera.
The demo calls warmUp() at page load, so the download+compile overlaps with the user
reading the landing text. By the time they tap Start, init() is done and only camera
permission + the 2s buffer remain. Verified headlessly: the detector reaches warm (GPU,
model loaded) during page load with no camera.

**Start is gated on readiness** (owner request): the button starts disabled and labelled
"Preparing…" with a spinner, and enables to "Start camera" only once the model is warm.
The download can't be avoided — the browser must fetch the model once to run detection
locally — but it is never invisible: the user sees a clear preparing state and starts when
ready, instead of tapping a button that appears to do nothing. On a warm failure the
button enables anyway, so a tap can retry and surface the real error.

**Not done, possible further wins if still too slow:** the model is only fetched when the
JS executes — an `<link rel=preload>` in index.html could start it a beat earlier, but
guessing the right WASM variant risks a double download. Warming is the safer 90%.

---

## 2026-07-24 — Mobile: 4-minute stall was GPU shader compile, not download

**Reported:** on a phone (14 Mbps) the app took ~4 minutes to start detecting after
"initialization," and Start let the user into the camera screen before anything was
ready — the readiness gate didn't hold.

**Root cause.** Two things, one underlying:

- The gate only waited for `warmUp()` = model **download + build**. MediaPipe compiles its
  GPU (WebGL) shaders on the **first `detectForVideo`**, not on load. On a weak mobile GPU
  that first inference can take minutes. So the button lit "ready" while the real cost was
  still ahead, during the post-Start INITIALIZING. 14 Mbps → the 15MB download is ~10s, so
  download was never the 4 minutes.
- Measured the same compile locally: desktop GPU warm-up 310ms vs CPU 123ms. The gap is
  the shader compile. On the phone that 310ms becomes minutes.

**Fixes.**

1. **Warm-up inference in `init()`** — after building the landmarker, run two
   `detectForVideo` calls on a blank 128px canvas to force the shader/kernel compile behind
   the loading UI. "Ready" is now truthful: the interview's first real frame is fast.
2. **Mobile defaults to the CPU delegate** (WASM SIMD) — no shader compile, starts almost
   immediately, at a lower frame rate presence tolerates fine. Desktop keeps GPU-first.
   `?delegate=gpu` / `?delegate=cpu` override. The delegate decision lives in the demo (UA
   sniff belongs in the UI layer), passed into the detector.
3. **Init timings in diagnostics** (`build Xms · warm-up Yms · simd=`) so a slow device
   reports where the time went — download/build vs GPU compile — instead of guessing.

**Watch:** CPU inference on a weak phone may run below 10fps. Presence still works (buffer +
hysteresis tolerate it), but if it dips under `lowFpsThreshold` (4) it reads as
`quality:degraded`. If that bites, lower targetFps on mobile rather than raising the fps
floor. Not yet measured on a real phone — confirm with the diagnostics block.

---

## Open threads

- **Does the interview client already hold a `MediaStream`?** Blocks IC-11. The stub
  supports both paths and `stop()` deliberately does not kill tracks it does not own,
  but the answer decides which path is real.
- **MediaPipe delegate choice under load** — unmeasured. The detector shares CPU with
  a live voice agent, and nothing is known yet about how they interact. IC-39.
- **Return-prompt wording** — unresolved, blocks IC-25. Needs to be neutral; the
  candidate may have an entirely good reason to be out of frame.
