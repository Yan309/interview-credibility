# Interview Credibility — Presence Module

Browser-side camera presence, absence and liveness detection for live interview
sessions. Detects when a candidate is no longer visible, prompts them to return,
and signals the host application when they have been absent too long.

- **Requirements:** [PRD.md](PRD.md)
- **Task board:** [TASKS.md](TASKS.md)
- **Every config knob explained:** [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- **Desktop test matrix:** [docs/test-matrix.md](docs/test-matrix.md)
- **Mobile test matrix:** [docs/mobile-test-matrix.md](docs/mobile-test-matrix.md)

> **Status:** pipeline working end to end on desktop — camera, MediaPipe detection,
> presence/absence, prompts and countdowns. Not yet validated on a phone; that is
> what [docs/mobile-test-matrix.md](docs/mobile-test-matrix.md) is for.

## Privacy invariant

No frame, landmark set, or image ever leaves the browser. Events carry scalars and
timestamps only. This is a hard constraint, not a preference — it is what keeps the
feature out of candidate-video retention territory. Any change that would send image
data anywhere needs an explicit product and legal decision first.

## Setup

```bash
npm install
npm run dev      # harness at http://localhost:5173
npm test         # camera-free unit tests
npm run typecheck
```

`predev` / `prebuild` run `npm run assets`, which copies the MediaPipe WASM bundle out of
`node_modules` and downloads `face_landmarker.task` (~3.6MB) once. Both land in `public/`
and are gitignored — they are reproducible, so they are never committed. **Any build
pipeline must run `npm run assets` or the deployed app 404s on the model.**

Node ≥20.11. Vite is pinned to 6.x because Vite 7 requires Node 20.19+.

## URL switches

| Parameter | Effect |
|---|---|
| `?debug=1` | Shows config sliders, event log, fps and state pill. Hidden by default |
| `?delegate=cpu` | Forces the CPU backend, for isolating GPU-specific behaviour |
| `?force=1` | Bypasses the in-app-browser block, if the UA sniff is wrong about a device |

Default view is deliberately clean: video, prompts, and a **Copy diagnostics** button.
That button is the whole remote-testing loop — a tester with no DevTools taps it once and
pastes device, camera, fps, delegate, build, the last 20 events and any caught errors.

## Testing on a phone

Two paths. Use the tunnel while iterating; deploy for anything a client touches.

**Local iteration** — run both, in separate terminals:

```bash
npm run dev:tunnel
```

```bash
cloudflared tunnel --url http://localhost:5173
```

`dev:tunnel` sets `--mode tunnel`, which enables `wss` HMR on port 443. Plain `npm run dev`
does not, because that config breaks ordinary localhost sessions. `cloudflared` prints a
`https://<random>.trycloudflare.com` URL — already allowlisted in `vite.config.ts`.

The URL changes on every restart, and it exposes an unauthenticated dev server serving
source. Fine for your own device; do not send it to a client, and stop it when done.

**Stable deploy** — for the client:

```bash
npm run deploy
```

Runs the build (including `assets`) and pushes `dist/` to Cloudflare Pages. First run needs
`npx wrangler login`. HTTPS is not optional here — `getUserMedia` requires a secure context,
so a plain-http host will fail on every phone.

> **Live URL:** _not yet deployed — record it here after the first `npm run deploy`._

To wire git auto-deploy, point a Cloudflare Pages project at the repo with build command
`npm run build` and output directory `dist`. The `assets` prebuild step runs automatically,
which is what keeps the model present in CI.

## Layout

```
src/core/     the module that ships — no UI framework dependency
  types.ts             public event and sample types
  config.ts            every tunable knob, with defaults and validation
  presence-machine.ts  rolling buffer + hysteresis → presence events
  liveness-scorer.ts   blink / head-pose / micro-motion scoring
  quality-monitor.ts   low-light and low-fps detection
  session-summary.ts   post-interview integrity record
  camera.ts            MediaStream lifecycle, error mapping
  detector.ts          MediaPipe FaceLandmarker wrap
  runtime.ts           sample loop, discontinuity guard, wiring

src/demo/     harness — NOT integrated, exists to calibrate and to demo
  diagnostics.ts       clipboard dump for remote testing
tests/        camera-free tests for the machine, scorer and detector maths
```

## Usage (target API)

```ts
import { PresenceRuntime } from './src/core/index.js';

const presence = new PresenceRuntime({
  // Pass the stream the interview client already holds — avoids a second
  // getUserMedia call on the same device.
  camera: { stream: existingStream },
  config: { absenceTimeoutMs: 45_000, absenceGraceMs: 4_000 },
});

presence.on('absence:started', () => showReturnPrompt());
presence.on('absence:resolved', () => hideReturnPrompt());
presence.on('absence:timeout', () => endInterview());   // host decides, not us
presence.on('quality:degraded', ({ reason }) => showBanner(reason));

await presence.start();
// ...later
presence.stop();
const summary = presence.getSessionSummary();
```

### What the module will not do

- It does not end the interview. `absence:timeout` is a report; the host app owns
  session lifecycle, transcript flushing and cleanup.
- It does not verify identity. Presence only — never *who* is in frame.
- It does not adjudicate. `liveness:suspect` is advisory and never candidate-facing.

## Design notes

**Hysteresis, not just buffering.** Presence is a ratio over a rolling window, and
the ratio to *enter* absence is lower than the ratio to *recover*. A candidate at
the edge of frame settles into one state instead of oscillating. On top of that,
`absenceGraceMs` passes silently before anyone is prompted.

**Degraded quality suspends escalation.** If the frame is too dark or the tab is
throttled, we say "we can't see you clearly" rather than "you left". Treating a dim
room as absence would end legitimate interviews, and would do so unevenly across
skin tones — so it is a fairness constraint, not just a robustness one.

**Two liveness signals minimum.** A single dead signal never flags. People do sit
still; the false-positive rate on honest candidates is the number that matters.

**Passive liveness does not defeat a replayed video.** Known and accepted gap.
Challenge-response would address it and is deliberately out of scope (IC-40).
