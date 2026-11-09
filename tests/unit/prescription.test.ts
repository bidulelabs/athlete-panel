import { describe, expect, it } from 'vitest';
import { prescriptionPreview } from '../../plugins/training/prescription';

describe('workout prescription', () => {
  it('shows a lap button end instead of a duration or distance', () => {
    const step = {
      kind: 'work' as const,
      durationSeconds: null,
      distanceMeters: null,
      target: null,
      notes: '',
    };
    expect(prescriptionPreview([{ ...step, endsOnLapButton: true }], 'metric')).toBe(
      'Until lap button',
    );
    expect(prescriptionPreview([{ ...step, durationSeconds: 300 }], 'metric')).toBe('5 min');
  });
});
