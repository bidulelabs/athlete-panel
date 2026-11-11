import type { WorkoutStep } from '@athlete-panel/contracts';

export type Units = 'metric' | 'imperial';
export type Interval = Exclude<WorkoutStep, { kind: 'repeat' }>;
const number = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 3 });

export function printTime(seconds: number | null | undefined): string {
  if (seconds == null) return 'Not specified';
  if (seconds > 0 && seconds < 1) return '<1 sec';
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return (
    [hours && `${hours} hr`, minutes && `${minutes} min`, remainder && `${remainder} sec`]
      .filter(Boolean)
      .join(' ') || '0 sec'
  );
}

export function printDistance(meters: number, units: Units): string {
  if (units === 'imperial') return `${number(meters / 1609.344)} mi`;
  return meters < 1000 ? `${number(meters)} m` : `${number(meters / 1000)} km`;
}

export function printTarget(target: NonNullable<Interval['target']>, units: Units): string {
  const pace = (seconds: number) => {
    const rounded = Math.round(seconds * (units === 'imperial' ? 1.609344 : 1));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
  };
  const format = target.kind === 'paceSecondsPerKilometer' ? pace : number;
  const value =
    target.min === target.max ? format(target.min) : `${format(target.min)}–${format(target.max)}`;
  switch (target.kind) {
    case 'paceSecondsPerKilometer':
      return `${value} / ${units === 'imperial' ? 'mi' : 'km'}`;
    case 'heartRateBpm':
      return `${value} bpm`;
    case 'powerWatts':
      return `${value} W`;
    case 'rpe':
      return `RPE ${value} / 10`;
  }
}

export function printLength(step: Interval, units: Units): string {
  if (step.endsOnLapButton) return 'Until lap button';
  if (step.durationSeconds !== null) return printTime(step.durationSeconds);
  return step.distanceMeters === null ? 'Not specified' : printDistance(step.distanceMeters, units);
}

export function printWeight(kilograms: number, units: Units): string {
  return `${number(kilograms * (units === 'imperial' ? 2.2046226218 : 1))} ${units === 'imperial' ? 'lb' : 'kg'}`;
}

export function printElevation(meters: number, units: Units): string {
  return `${number(meters * (units === 'imperial' ? 3.280839895 : 1))} ${units === 'imperial' ? 'ft' : 'm'} ascent`;
}
