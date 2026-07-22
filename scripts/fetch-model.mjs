#!/usr/bin/env node
/**
 * One-time download of the FaceLandmarker model into public/models/.
 *
 * The model is ~3.7MB and is not published to npm, so it cannot be vendored by
 * `npm install`. This is a deliberate, explicit step rather than a postinstall
 * hook: a build that silently reaches out to a Google bucket is exactly the kind
 * of thing this project's privacy posture says it should not do quietly.
 *
 * Once downloaded, nothing else in the app makes an external request.
 *
 * Run: npm run fetch:model
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'models', 'face_landmarker.task');

if (existsSync(target)) {
  const { size } = await stat(target);
  console.log(`[fetch-model] already present (${(size / 1e6).toFixed(1)}MB) — nothing to do.`);
  process.exit(0);
}

console.log(`[fetch-model] downloading from ${MODEL_URL}`);

const response = await fetch(MODEL_URL);
if (!response.ok) {
  console.error(`[fetch-model] failed: HTTP ${response.status} ${response.statusText}`);
  process.exit(1);
}

const bytes = Buffer.from(await response.arrayBuffer());
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);

console.log(`[fetch-model] saved ${(bytes.length / 1e6).toFixed(1)}MB to public/models/face_landmarker.task`);
