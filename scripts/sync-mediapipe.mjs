#!/usr/bin/env node
/**
 * Copies the MediaPipe WASM bundle from node_modules into public/mediapipe/wasm.
 *
 * The usual MediaPipe examples load these from a CDN. We serve them locally
 * instead: an interview that fails because someone else's CDN is unreachable is
 * an interview that fails for a reason the candidate cannot do anything about.
 * It also keeps the runtime free of third-party requests, which is easier to
 * defend given the privacy posture in PRD.md §6.5.
 *
 * Runs automatically via predev/prebuild.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.error('[sync-mediapipe] @mediapipe/tasks-vision is not installed. Run: npm install');
  process.exit(1);
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const files = await readdir(target);
console.log(`[sync-mediapipe] copied ${files.length} files to public/mediapipe/wasm`);

// The model itself is ~3.7MB and is not distributed via npm. It has to be
// fetched once; say so precisely rather than failing later with a 404 at runtime.
const model = join(root, 'public', 'models', 'face_landmarker.task');
if (!existsSync(model)) {
  console.warn(
    '\n[sync-mediapipe] public/models/face_landmarker.task is MISSING.\n' +
      '  Detection will 404 until it is downloaded. One-time step:\n\n' +
      '  npm run fetch:model\n',
  );
}
