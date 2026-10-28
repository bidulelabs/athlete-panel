import { describe, expect, it } from 'vitest';
import { distanceFieldText, distanceMetersFromField } from '../../plugins/training/distance-field';

const mile = 1609.344;

describe('workout distance field', () => {
  it('keeps the stored meters when the shown value is submitted unchanged', () => {
    expect(distanceFieldText(5000, mile)).toBe('3.107');
    expect(distanceMetersFromField('3.107', 5000, mile)).toBe(5000);
    expect(distanceMetersFromField('5.123', 5123.4567, 1000)).toBe(5123.4567);
  });

  it('converts an edited value and clears an emptied one', () => {
    expect(distanceMetersFromField('3', 5000, mile)).toBe(3 * mile);
    expect(distanceMetersFromField('2', null, 1000)).toBe(2000);
    expect(distanceMetersFromField('', 5000, mile)).toBeNull();
  });
});
