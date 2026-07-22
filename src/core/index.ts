/**
 * Public API for the presence module.
 *
 * The host interview app should import from here and nothing deeper.
 */

export { PresenceRuntime, type PresenceRuntimeOptions } from './runtime.js';
export { PresenceMachine } from './presence-machine.js';
export { LivenessScorer } from './liveness-scorer.js';
export { QualityMonitor } from './quality-monitor.js';
export { SessionSummaryBuilder } from './session-summary.js';
export { PresenceEmitter, type Unsubscribe } from './emitter.js';
export { CameraSource, CameraError, toCameraErrorReason, type CameraOptions } from './camera.js';
export {
  MediaPipeFaceDetector,
  ScriptedDetector,
  type FaceDetector,
  type DetectorOptions,
} from './detector.js';
export {
  DEFAULT_CONFIG,
  resolveConfig,
  assertConfig,
  type PresenceConfig,
  type LivenessConfig,
  type MultiFacePolicy,
  type DeepPartial,
} from './config.js';
export type {
  PresenceEvent,
  PresenceEventType,
  PresenceState,
  DetectionSample,
  SessionSummary,
  QualityReason,
  CameraErrorReason,
  LivenessSignal,
} from './types.js';
