export const appleWorkoutDate = '2026-11-17';
export const appleUuid = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

export const appleConnectionTest = { app: 'salute-libera', versione: 1, prova: true };

export function appleBatch(overrides: Record<string, unknown>) {
  return {
    app: 'salute-libera',
    versione: 1,
    dispositivo: 'iPhone17,1',
    inviato: '2026-11-27T10:04:00+01:00',
    ...overrides,
  };
}

export const appleRoutePoints = Array.from({ length: 6 }, (_, index) => ({
  lat: 45.46 + index * 0.00045,
  lon: 9.19,
  alt: 122 + index * 4,
  t: `${appleWorkoutDate}T09:12:0${index}Z`,
}));

export function appleWorkout(id: number, overrides: Record<string, unknown> = {}) {
  return {
    uuid: appleUuid(id),
    attivita: 'running',
    inizio: `${appleWorkoutDate}T09:12:00Z`,
    fine: `${appleWorkoutDate}T09:57:00Z`,
    durata_s: 2700,
    distanza_m: 7600,
    fonte: 'Synthetic Apple Watch',
    statistiche: {
      HKQuantityTypeIdentifierHeartRate: { unita: 'count/min', media: 148, massimo: 171 },
    },
    metadati: { HKIndoorWorkout: '0', HKTimeZone: 'Europe/Paris', HKElevationAscended: '140 m' },
    ...overrides,
  };
}
