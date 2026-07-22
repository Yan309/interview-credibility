# Manual Test Matrix

Physical conditions that cannot be covered by unit tests. Run against `npm run dev`
with the event log visible. Record the result and the config values in use.

**Legend:** ✅ pass · ⚠️ pass with caveat · ❌ fail · — not yet run

---

## Phase 4 — Stabilization (IC-32, IC-33)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| 4.1 | 10-min seated session, natural movement | **Zero** `absence:started` | — | The M4 gate |
| 4.2 | Turn head to think, ~2s | No prompt | — | |
| 4.3 | Reach off-desk for a drink, ~3s | No prompt | — | |
| 4.4 | Lean back fully in chair | Stays present | — | Distance ≠ absence |
| 4.5 | Deliberate 1s look-away | No prompt | — | Paired with 4.6 |
| 4.6 | Deliberate 5s exit from frame | Prompt appears | — | Paired with 4.5 |
| 4.7 | Leave for full timeout | One `absence:timeout` | — | Exactly one |
| 4.8 | Return mid-countdown | Prompt clears, no timeout | — | |

## Phase 5 — Environmental (IC-24, IC-34, IC-35, IC-36)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| 5.1 | Room lights off, screen glow only | `quality:degraded(low-light)` | — | **Never** `absence:started` |
| 5.2 | Strong backlight (window behind) | Degraded or present; not absent | — | |
| 5.3 | Low light, dark skin tone | Same as 5.1 | — | **Fairness case — must be run** |
| 5.4 | Low light, light skin tone | Same as 5.1 | — | Compare thresholds against 5.3 |
| 5.5 | Recover from darkness | `quality:restored`, no back-dated absence | — | |
| 5.6 | Hand covering chin/mouth | Stays present | — | |
| 5.7 | Hair across half the face | Stays present | — | |
| 5.8 | Glasses with heavy glare | Stays present | — | |
| 5.9 | Second person walks behind, ~2s | No `multiface:detected` | — | Under grace |
| 5.10 | Second person seated alongside | `multiface:detected` after grace | — | Presence undisturbed |
| 5.11 | Second person leaves | `multiface:cleared` | — | |

## Phase 6 — Mask & liveness (IC-30, IC-37)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| 6.1 | Surgical mask, good light | ≥95% frames present | — | |
| 6.2 | Cloth mask, good light | ≥95% frames present | — | |
| 6.3 | Mask + low light | Degraded, not absent | — | |
| 6.4 | Printed photo held up | `liveness:suspect` ≤ 2 windows | — | |
| 6.5 | Photo taped in front of lens | `liveness:suspect` | — | |
| 6.6 | Phone screen showing a still face | `liveness:suspect` | — | |
| 6.7 | Live person sitting very still, 3 min | **No** flag | — | **The metric that matters** |
| 6.8 | Live person reading, minimal movement | No flag | — | |
| 6.9 | Replayed video of the candidate | Known gap — likely no flag | — | Document, do not fix (IC-40) |

## Camera lifecycle (IC-11, IC-12, IC-13)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| 7.1 | Deny permission at prompt | `camera:error(permission-denied)` | — | |
| 7.2 | No camera attached | `camera:error(no-device)` | — | |
| 7.3 | Camera held by another app | `camera:error(device-busy)` | — | Common on Windows |
| 7.4 | Unplug camera mid-session | `camera:error(track-ended)`, no crash | — | |
| 7.5 | Background the tab, 60s | `quality:degraded(low-fps)`, no timeout | — | |
| 7.6 | Close lid, reopen after 5 min | No absence for the gap | — | IC-21 |

## Performance (IC-39)

| # | Scenario | Target | Result | Notes |
|---|---|---|---|---|
| 8.1 | Sustained fps, mid-range laptop | ≥10 | — | |
| 8.2 | CPU while detecting | ≤10% | — | |
| 8.3 | Running alongside a live voice session | No dropped frames either side | — | The real test |

---

## Run log

| Date | Phase | Config snapshot | Outcome |
|---|---|---|---|
| — | — | — | — |
