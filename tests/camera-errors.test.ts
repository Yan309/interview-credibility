import { describe, expect, it } from 'vitest';
import { toCameraErrorReason } from '../src/core/camera.js';

/**
 * The per-browser DOMException mapping is the part of the camera layer worth
 * testing without hardware — browsers disagree, and getting it wrong shows the
 * candidate the wrong recovery instruction.
 */

const domException = (name: string): { name: string; message: string } => ({
  name,
  message: `simulated ${name}`,
});

describe('toCameraErrorReason', () => {
  it('maps permission denial across browsers', () => {
    expect(toCameraErrorReason(domException('NotAllowedError'))).toBe('permission-denied');
    expect(toCameraErrorReason(domException('PermissionDeniedError'))).toBe('permission-denied');
    expect(toCameraErrorReason(domException('SecurityError'))).toBe('permission-denied');
  });

  it('maps a missing or unmatchable device', () => {
    expect(toCameraErrorReason(domException('NotFoundError'))).toBe('no-device');
    expect(toCameraErrorReason(domException('DevicesNotFoundError'))).toBe('no-device');
    expect(toCameraErrorReason(domException('OverconstrainedError'))).toBe('no-device');
  });

  it('maps a busy device, including the Firefox spelling', () => {
    // Chrome says NotReadableError; Firefox reports the same situation as
    // AbortError. Treating AbortError as generic loses the "close the other app"
    // instruction on Firefox specifically.
    expect(toCameraErrorReason(domException('NotReadableError'))).toBe('device-busy');
    expect(toCameraErrorReason(domException('TrackStartError'))).toBe('device-busy');
    expect(toCameraErrorReason(domException('AbortError'))).toBe('device-busy');
  });

  it('maps an insecure origin to unsupported', () => {
    expect(toCameraErrorReason(domException('TypeError'))).toBe('unsupported');
  });

  it('does not throw on junk input', () => {
    // This runs in a rejection path. Throwing here would mask the original error.
    expect(toCameraErrorReason(undefined)).toBe('unsupported');
    expect(toCameraErrorReason(null)).toBe('unsupported');
    expect(toCameraErrorReason('a string')).toBe('unsupported');
    expect(toCameraErrorReason({})).toBe('unsupported');
  });
});
