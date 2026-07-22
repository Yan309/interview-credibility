# Mobile Test Matrix

Physical test script for phone testing. **The engineer runs this** with `?debug=1`;
the client does an unstructured pass and taps **Copy diagnostics** when something looks
wrong. The matrix needs the event log and fps readout, which the client's view hides.

Record the outcome in every cell — including failures. **A matrix with only passes in it
is not evidence.** Blank means not run, not "fine".

## Before you start

- [ ] Live URL loads over **https** (`isSecureContext` true — the diagnostics dump shows it)
- [ ] **Disable auto-lock** on each device, or section C measures the screen timeout
      rather than the thing under test. Note which you did.
- [ ] Note build stamp (bottom-left corner) — every result is only valid for one build
- [ ] Paste a diagnostics dump into the results doc before the first test, as a baseline

## Devices

| Col | Device | OS / browser | Tester |
|---|---|---|---|
| D1 | iPhone (recent) | iOS __ / Safari | |
| D2 | iPhone (older, 3+ yrs) | iOS __ / Safari | |
| D3 | Android flagship | Android __ / Chrome | |
| D4 | Android budget | Android __ / Chrome | |

Include at least one older and one budget device. They are where thermal throttling, low
frame rates and weak cameras actually show up — a matrix run only on new hardware tells
you nothing about the candidates most likely to struggle.

---

## A — Camera acquisition

| # | Test | Expected | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|---|
| A1 | Load page | Landing screen, no permission prompt yet | | | | |
| A2 | Tap Start, **allow** | Video appears within ~3s | | | | |
| A3 | **Front camera used** | You see yourself, not the room behind | | | | |
| A4 | Video plays inline | Never goes fullscreen, no play button overlay | | | | |
| A5 | Tap Start, **deny** | "Camera permission is blocked" + how to re-enable | | | | |
| A6 | Retry after re-enabling | Recovers without a full page reload | | | | |
| A7 | Reload mid-session | Returns to landing; camera does not auto-start | | | | |
| A8 | Sustained fps after 60s | ≥ 8fps (target 10) | | | | |
| A9 | Delegate reported | GPU or CPU, recorded per device | | | | |
| A10 | Open in Instagram/LinkedIn in-app browser | "Open in browser" screen, no Start button | | | | |

**A3 is first for a reason.** `facingMode: { ideal: 'user' }` is new and has never run on a
phone. If a device hands back the rear camera, every candidate reads as absent and gets
timed out — the failure looks like broken detection, not a camera-selection bug.

---

## B — Presence detection

Run with `?debug=1` so the event log is visible.

| # | Test | Expected | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|---|
| B1 | Sit normally, 60s | State PRESENT throughout, zero prompts | | | | |
| B2 | Walk out of frame | Prompt after ~3s grace, countdown runs | | | | |
| B3 | Return during grace (~2s) | **No prompt ever appears** | | | | |
| B4 | Return after prompt | Prompt clears, countdown resets | | | | |
| B5 | Cover lens 10s | Registers absence, not a frozen "present" | | | | |
| B6 | **Handheld, 2 min natural sway** | **Zero prompts** | | | | |
| B7 | Arm's length vs very close | Present at both distances | | | | |
| B8 | **Start with phone face-down**, then pick up | Prompt fires after grace; picking up clears it | | | | |
| B9 | Turn head to read something, 3s | No prompt | | | | |

**B6 is the mobile equivalent of the P4 gate and the single most important row here.**
Handheld motion stresses hysteresis in ways a desk-mounted webcam never does. If this
fails, the thresholds in `DEFAULT_CONFIG` are desktop-only and mobile needs its own
profile.

**B8 covers the cold-start-absent path** — fixed 2026-07-22 and currently only proven by
unit tests.

---

## C — Mobile interruptions

**Highest-risk section.** Phones suspend timers and throttle background tabs aggressively.
The correct behaviour throughout is a **discontinuity reset**: on resume the module
discards the stale window and re-initialises. It must **not** back-date the gap as an
absence and time the candidate out for locking their phone.

| # | Test | Expected | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|---|
| C1 | **Lock screen 30s, unlock** | No `absence:*` for the gap; detection resumes | | | | |
| C2 | **Switch apps 30s, return** | Same as C1 | | | | |
| C3 | Lock screen 3 min, unlock | Same as C1 — no timeout fired while locked | | | | |
| C4 | Incoming call, decline | Camera recovers, or clean `track-ended` screen | | | | |
| C5 | Incoming call, accept then end | Recovers or shows a retry screen — never blank | | | | |
| C6 | Rotate portrait ↔ landscape | Video reflows, detection continues | | | | |
| C7 | Low Power Mode on (iOS) | fps recorded; note any throttling | | | | |
| C8 | Battery saver on (Android) | fps recorded | | | | |
| C9 | 5 min continuous, note temperature | fps at 1/3/5 min; note if device warms | | | | |
| C10 | Pull-to-refresh mid-session | Returns to landing cleanly | | | | |

For C1–C3, capture the **event log** around the gap, not just the end state. "It looked
fine" cannot distinguish a correct reset from an absence that happened to resolve.

---

## D — Conditions

| # | Test | Expected | D1 | D2 | D3 | D4 |
|---|---|---|---|---|---|---|
| D1 | Dim room | `quality:degraded` (low-light), **not** absence | | | | |
| D2 | **Lighting prompt appears** | Names low light, countdown runs | | | | |
| D3 | **Fix lighting before expiry** | Prompt clears, no termination | | | | |
| D4 | **Let lighting countdown expire** | `quality:timeout`; summary shows `qualityTimedOut: true` and `timedOut: false` | | | | |
| D5 | **Dark room, face still visible** | **No `quality:timeout`** — the clock must not run | | | | |
| D6 | Backlit (window behind) | Present, or degraded — never a false absence | | | | |
| D7 | Surgical mask | **Present throughout** | | | | |
| D8 | Cloth mask | Present throughout | | | | |
| D9 | Hand over chin/mouth | Still present | | | | |
| D10 | Second person enters | `multiface:detected` after grace; presence unaffected | | | | |
| D11 | Held photo of a face | `liveness:suspect` within two windows | | | | |
| D12 | Live person very still, 3 min | **No `liveness:suspect`** | | | | |

**D4 and D5 are the newest termination path and have never run on hardware.** D5 is the
guard: if a face is detectable, the lighting clock must not run at all. If D5 ever fails,
stop and fix it — a visible candidate being timed out for room lighting is the worst
outcome this module can produce.

**D12 matters more than D11.** A missed photo is cheap; flagging an honest candidate who
happens to sit still is not.

---

## E — Fairness (blocking, do not skip)

**Requires multiple testers with different skin tones.** This cannot be inferred from one
person passing section D, and it cannot be run by a single tester.

Face detection degrades unevenly across skin tones. `lowLightLumaThreshold` is no longer
just a tuning value — it is the sole input to a termination path (`quality:timeout`), so
a threshold calibrated on one skin tone decides who gets timed out.

| # | Test | Expected | T1 | T2 | T3 |
|---|---|---|---|---|---|
| E1 | Same room, same lighting, each tester | Same state for all — record luma per tester | | | |
| E2 | Dim lighting, each tester | Degraded for all, or none. **Not some** | | | |
| E3 | Backlit, each tester | Consistent outcome | | | |
| E4 | Lighting countdown behaviour | No tester reaches `quality:timeout` sooner than another in the same room | | | |

If outcomes differ between testers under identical lighting, **that is the finding**. Do
not average the thresholds — record the spread and raise it. Phone cameras have smaller
sensors and more aggressive auto-exposure than laptop webcams, so expect this to be worse
on mobile, not better.

---

## Sign-off

| Gate | Met? | Notes |
|---|---|---|
| Every device opens and starts on tap | | |
| B6 handheld: zero false prompts on all devices | | |
| C1/C2/C3: no absence events for suspend gaps | | |
| D5: visible face never quality-times-out | | |
| D7: mask present throughout | | |
| E: consistent across testers | | |

Anything unmet stays a blocker. An unmet gate recorded as passed is the failure this
module exists to prevent — except here the person it lands on is a real candidate.
