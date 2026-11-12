import { describe, expect, it } from 'vitest';
import { targetAndPlannedParts, weekHoursLabel } from '../../plugins/calendar/week-hours';

const hours = (value: number) => ({ value: value * 3600, knownCount: 1, missingCount: 0 });
const none = { value: 0, knownCount: 0, missingCount: 0 };
const unmeasured = { value: null, knownCount: 0, missingCount: 1 };
const target = { min: 8 * 3600, max: 10 * 3600 };

describe('week hours label', () => {
  it('shows target, planned and recorded hours', () => {
    expect(weekHoursLabel(hours(9), hours(7), target)).toBe(
      'Target 8–10 h · Planned 9 h · Recorded 7 h',
    );
  });

  it('shows only the target, or No plan, when a week has no sessions', () => {
    expect(weekHoursLabel(none, none, target)).toBe('Target 8–10 h');
    expect(weekHoursLabel(none, none, null)).toBe('No plan');
  });

  it('shows only the parts that exist', () => {
    expect(weekHoursLabel(hours(9), none, null)).toBe('Planned 9 h');
    expect(weekHoursLabel(none, hours(7.5), null)).toBe('Recorded 7.5 h');
    expect(weekHoursLabel(unmeasured, hours(7), null)).toBe('Planned — · Recorded 7 h');
  });

  it('lists target and planned hours without recorded hours', () => {
    expect(targetAndPlannedParts(hours(9), target)).toEqual(['Target 8–10 h', 'Planned 9 h']);
    expect(targetAndPlannedParts(none, null)).toEqual([]);
  });
});
