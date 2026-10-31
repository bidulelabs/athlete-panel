import { describe, expect, it } from 'vitest';
import { storedFromUnitField, unitFieldText } from '../../plugins/training/unit-field';

const mile = 1609.344;

describe('workout distance field', () => {
  it('keeps the stored meters when the shown value is submitted unchanged', () => {
    expect(unitFieldText(5000, mile)).toBe('3.107');
    expect(storedFromUnitField('3.107', 5000, mile)).toBe(5000);
    expect(storedFromUnitField('5.123', 5123.4567, 1000)).toBe(5123.4567);
  });

  it('converts an edited value and clears an emptied one', () => {
    expect(storedFromUnitField('3', 5000, mile)).toBe(3 * mile);
    expect(storedFromUnitField('2', null, 1000)).toBe(2000);
    expect(storedFromUnitField('', 5000, mile)).toBeNull();
  });
});

describe('workout duration field', () => {
  it('keeps the stored seconds when the shown minutes are submitted unchanged', () => {
    expect(unitFieldText(31, 60)).toBe('0.517');
    expect(storedFromUnitField('0.517', 31, 60)).toBe(31);
  });

  it('converts edited minutes and clears an emptied field', () => {
    expect(storedFromUnitField('0.5', 31, 60)).toBe(30);
    expect(storedFromUnitField('45', null, 60)).toBe(2700);
    expect(storedFromUnitField('', 31, 60)).toBeNull();
  });
});
