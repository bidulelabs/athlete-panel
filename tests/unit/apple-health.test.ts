import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { canLinkSport } from '@athlete-panel/contracts';
import { normalizeWorkout } from '../../plugins/apple-health/normalize';
import { parseUpload, readUpload } from '../../plugins/apple-health/protocol';
import { parseTrack } from '../../plugins/race-analysis/parse';
import {
  appleBatch,
  appleConnectionTest,
  appleRoutePoints,
  appleWorkout,
} from '../fixtures/apple-health';

describe('Sync for Health v1', () => {
  it('reads the connection probe, diagnostic envelope, and compressed workout batch', async () => {
    expect(parseUpload(appleConnectionTest)).toEqual({ kind: 'test' });
    expect(parseUpload(appleBatch({ diagnostica: { righe: ['private diagnostic'] } }))).toEqual({
      kind: 'diagnostics',
    });
    const body = new Uint8Array(
      gzipSync(JSON.stringify(appleBatch({ allenamenti: [appleWorkout(1)] }))),
    );
    const request = new Request('https://athlete.example/api/apple-health/workouts', {
      method: 'POST',
      body,
      headers: { 'Content-Encoding': 'gzip' },
    });
    await expect(readUpload(request)).resolves.toMatchObject({
      kind: 'batch',
      batch: { allenamenti: [appleWorkout(1)] },
    });
    expect(() => parseUpload({ ...appleConnectionTest, allenamenti: [appleWorkout(1)] })).toThrow();
    expect(() => parseUpload({ ...appleConnectionTest, versione: 2 })).toThrow();
  });

  it('bounds both the wire bytes and the gzip expansion', async () => {
    const url = 'https://athlete.example/api/apple-health/workouts';
    await expect(
      readUpload(
        new Request(url, {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Length': String(33 * 1024 * 1024) },
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    const body = new Uint8Array(gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1)));
    await expect(
      readUpload(
        new Request(url, {
          method: 'POST',
          body,
          headers: { 'Content-Encoding': 'gzip' },
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('preserves provider facts and zeroes and falls back to the profile timezone', () => {
    const run = normalizeWorkout(
      appleWorkout(1, {
        inizio: '2026-11-17T23:30:00Z',
        fine: '2026-11-18T00:15:00Z',
        durata_s: 0,
        distanza_m: null,
        metadati: {
          HKTimeZone: 'Europe/Paris',
          HKIndoorWorkout: '1',
          HKElevationAscended: '10 ft',
        },
      }),
      'UTC',
    );
    expect(run?.facts).toMatchObject({
      localDate: '2026-11-18',
      dateSource: 'provider',
      durationSeconds: 0,
      distanceMeters: null,
      elevationMeters: 3.048,
      sport: 'running',
      sportSubgroup: 'indoor_running',
      averageHeartRateBpm: 148,
      maxHeartRateBpm: 171,
    });
    expect(
      normalizeWorkout(
        appleWorkout(2, {
          inizio: '2026-11-17T23:30:00Z',
          fine: '2026-11-18T00:15:00Z',
          attivita: 'activity_444',
          metadati: undefined,
        }),
        'Europe/Paris',
      )?.facts,
    ).toMatchObject({
      localDate: '2026-11-18',
      dateSource: 'inferred',
      sportResolution: 'unresolved',
    });
  });

  it.each([
    ['swim_bike_run', 'multi_sport', null],
    ['multisport', 'multi_sport', null],
    ['pilates', 'fitness_equipment', 'pilates'],
    ['elliptical', 'fitness_equipment', 'elliptical'],
    ['traditional_strength_training', 'fitness_equipment', 'strength_training'],
    ['mixed_cardio', 'fitness_equipment', 'indoor_cardio'],
    ['other', 'other', null],
  ])('matches the phone workout type %s to a planned session', (attivita, sport, sportSubgroup) => {
    const activity = normalizeWorkout(appleWorkout(1, { attivita }), 'UTC')!.facts;
    expect(activity).toMatchObject({
      sport,
      sportSubgroup,
      sportResolution: 'resolved',
      appleHealth: { workoutType: attivita },
    });
    expect(canLinkSport({ sport: sport!, sportSubgroup }, activity)).toBe(true);
  });

  it('round-trips the GPX with elevation and time while keeping route-derived ascent separate', () => {
    const result = normalizeWorkout(
      appleWorkout(1, {
        percorso: appleRoutePoints,
        metadati: {},
      }),
      'UTC',
    )!;
    expect(result.facts.elevationMeters).toBeNull();
    expect(result.facts.appleHealth.estimatedElevationMeters).toBeGreaterThan(0);
    const track = parseTrack(
      { name: 'run.gpx', bytes: Buffer.from(result.route!.gpx) },
      'reference',
    );
    expect(track.points).toHaveLength(6);
    expect(track.points[0]).toMatchObject({
      latitude: 45.46,
      longitude: 9.19,
      elevation: 122,
      time: Date.parse(appleRoutePoints[0]!.t),
    });
    expect(normalizeWorkout(appleWorkout(2, { percorso: [{ lat: 1000 }] }), 'UTC')).toMatchObject({
      invalidRoute: true,
      facts: { appleHealth: { routeAvailable: false } },
    });
  });
});
