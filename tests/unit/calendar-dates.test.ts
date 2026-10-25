import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileSchema, profileValuesSchema } from '@athlete-panel/contracts';
import { addDays, localDate, orderedWeekdays, resolveWeekStartsOn, startOfWeek } from '../../packages/ui/src/calendar-dates';

afterEach(() => vi.restoreAllMocks());

describe('calendar week preferences', () => {
  it('loads older profiles as Automatic and validates explicit choices', () => {
    const older = profileSchema.parse({ id: 'owner', revision: 1 });
    expect(older).not.toHaveProperty('weekStartsOnPreference');
    expect(resolveWeekStartsOn(older.weekStartsOnPreference, 'en-US')).toBe(0);
    for (const preference of ['auto', 'sunday', 'monday']) expect(profileValuesSchema.parse({ weekStartsOnPreference: preference }).weekStartsOnPreference).toBe(preference);
    for (const preference of ['saturday', 0, null]) expect(profileValuesSchema.safeParse({ weekStartsOnPreference: preference }).success).toBe(false);
  });

  it('resolves browser regions and gives explicit choices priority', () => {
    expect(resolveWeekStartsOn('auto', 'en-US')).toBe(0);
    expect(resolveWeekStartsOn('auto', 'fr-FR')).toBe(1);
    expect(resolveWeekStartsOn('auto', 'en-GB')).toBe(1);
    expect(resolveWeekStartsOn('monday', 'en-US')).toBe(1);
    expect(resolveWeekStartsOn('sunday', 'fr-FR')).toBe(0);
    expect(resolveWeekStartsOn('auto', 'invalid_locale_123')).toBe(1);
    expect(resolveWeekStartsOn()).toBe(1);
  });

  it('supports both week-info API shapes and the legacy US fallback', () => {
    vi.spyOn(Intl, 'Locale').mockImplementation(function () {
      return { getWeekInfo: () => ({ firstDay: 7 }), region: 'CA' } as unknown as Intl.Locale;
    } as never);
    expect(resolveWeekStartsOn('auto', 'en-CA')).toBe(0);
    vi.mocked(Intl.Locale).mockImplementation(function () { return { weekInfo: { firstDay: 7 } } as unknown as Intl.Locale; } as never);
    expect(resolveWeekStartsOn('auto', 'en-CA')).toBe(0);
    vi.mocked(Intl.Locale).mockImplementation(function () { return { region: 'US' } as Intl.Locale; } as never);
    expect(resolveWeekStartsOn('auto', 'en-US')).toBe(0);
    vi.mocked(Intl.Locale).mockImplementation(function () { throw new Error('Unavailable'); } as never);
    expect(resolveWeekStartsOn('auto', 'en_US')).toBe(0);
    expect(resolveWeekStartsOn('auto', 'fr-FR')).toBe(1);
  });

  it('orders complete weeks and handles Sunday, leap day and year boundaries', () => {
    expect(orderedWeekdays(0)).toEqual(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
    expect(orderedWeekdays(1)).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
    expect(startOfWeek('2030-01-06', 0)).toBe('2030-01-06');
    expect(startOfWeek('2030-01-06', 1)).toBe('2029-12-31');
    expect(startOfWeek('2028-02-29', 0)).toBe('2028-02-27');
    expect(startOfWeek('2028-02-29', 1)).toBe('2028-02-28');
    expect(() => startOfWeek('2026-02-29', 0)).toThrow();
  });

  it('keeps seven floating days across both DST transitions', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      expect(startOfWeek(date, 0)).toBe(date);
      expect(startOfWeek(date, 1)).toBe(addDays(date, -6));
      expect(startOfWeek(addDays(date, 7), 0)).toBe(addDays(date, 7));
    }
  });

  it('uses the athlete timezone for Today at the Saturday/Sunday boundary', () => {
    const instant = new Date('2026-10-25T00:30:00Z');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-10-24');
    expect(localDate(instant, 'Europe/Paris')).toBe('2026-10-25');
    expect(startOfWeek(localDate(instant, 'America/Los_Angeles'), 0)).toBe('2026-10-18');
    expect(startOfWeek(localDate(instant, 'Europe/Paris'), 0)).toBe('2026-10-25');
  });
});
