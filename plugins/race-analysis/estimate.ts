import type { CourseEstimate, ReferenceEffort, TrackAnalysis } from '@athlete-panel/contracts';

type Evidence = Pick<
  ReferenceEffort,
  'distanceMeters' | 'ascentMeters' | 'durationSeconds' | 'terrain' | 'hasGaps'
>;
type Model = { pace: number; climb: number; fatigue: number; limitedClimbing: boolean };
const terrainFactor = (level: number) => 1 + (level - 1) * 0.035;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const totalTime = (base: number, fatigue: number) => base + (fatigue * base * base) / 7200;
function baseTime(seconds: number, fatigue: number) {
  return fatigue === 0
    ? seconds
    : (2 * seconds) / (1 + Math.sqrt(1 + (4 * fatigue * seconds) / 7200));
}
export function usableReference(ref: Evidence): boolean {
  return (
    ref.durationSeconds !== null &&
    ref.ascentMeters !== null &&
    !ref.hasGaps &&
    ref.distanceMeters >= 100
  );
}
function predict(ref: Pick<Evidence, 'distanceMeters' | 'ascentMeters' | 'terrain'>, model: Model) {
  return totalTime(
    ((ref.distanceMeters / 1000) * model.pace + ((ref.ascentMeters ?? 0) / 100) * model.climb) *
      terrainFactor(ref.terrain),
    model.fatigue,
  );
}
/** Small bounded two-coefficient regression; the slowdown grid avoids an unstable three-way fit. */
function fit(refs: Evidence[]): Model {
  const ratios = refs.map((r) => r.ascentMeters! / r.distanceMeters);
  const limitedClimbing = Math.max(...ratios) - Math.min(...ratios) < 0.015;
  let best: Model = { pace: 360, climb: 60, fatigue: 0, limitedClimbing },
    bestLoss = Infinity;
  for (const fatigue of [0, 0.02, 0.04, 0.06]) {
    let xx = 0,
      xz = 0,
      zz = 0,
      xy = 0,
      zy = 0;
    for (const ref of refs) {
      const x = ref.distanceMeters / 1000,
        z = ref.ascentMeters! / 100;
      const y = baseTime(ref.durationSeconds!, fatigue) / terrainFactor(ref.terrain);
      // Relative-time weights keep a long race from overwhelming shorter evidence.
      const weight = 1 / (ref.durationSeconds! / 3600) ** 2;
      xx += weight * x * x;
      xz += weight * x * z;
      zz += weight * z * z;
      xy += weight * x * y;
      zy += weight * z * y;
    }
    const ridge = Math.max(0.01, xx * 0.002);
    const det = (xx + ridge) * (zz + ridge) - xz * xz;
    const climb = limitedClimbing
      ? 60
      : clamp(((zy + ridge * 60) * (xx + ridge) - xz * (xy + ridge * 360)) / det, 0, 300);
    const pace = clamp((xy - xz * climb) / xx, 120, 1800);
    const model = { pace, climb, fatigue, limitedClimbing };
    const loss =
      refs.reduce(
        (sum, r) => sum + ((predict(r, model) - r.durationSeconds!) / r.durationSeconds!) ** 2,
        0,
      ) +
      fatigue * 0.01;
    if (loss < bestLoss) {
      best = model;
      bestLoss = loss;
    }
  }
  return best;
}
function sectionTimes(
  track: TrackAnalysis,
  terrain: number,
  overrides: Record<string, number>,
  model: Model,
) {
  let baseSoFar = 0;
  return track.sections.map((section) => {
    const previous = totalTime(baseSoFar, model.fatigue);
    baseSoFar +=
      (((section.toMeters - section.fromMeters) / 1000) * model.pace +
        ((section.ascentMeters ?? 0) / 100) * model.climb) *
      terrainFactor(overrides[String(section.index)] ?? terrain);
    return totalTime(baseSoFar, model.fatigue) - previous;
  });
}
export function estimateCourse(
  track: TrackAnalysis | null,
  terrain: number,
  sectionTerrain: Record<string, number>,
  references: ReferenceEffort[],
): { estimate: CourseEstimate | null; estimateReasons: string[]; references: ReferenceEffort[] } {
  const evidence = references.filter(usableReference);
  const compared = references.map((ref) => {
    const others = evidence.filter((r) => r.id !== ref.id);
    const predicted = usableReference(ref) && others.length >= 3 ? predict(ref, fit(others)) : null;
    return {
      ...ref,
      predictedSeconds: predicted !== null && predicted <= 30 * 86400 ? predicted : null,
      comparison:
        predicted !== null && predicted <= 30 * 86400
          ? ('held-out' as const)
          : ('unavailable' as const),
    };
  });
  const reasons: string[] = [];
  if (!track) reasons.push('Upload a GPX course to see its distance, profile and estimate.');
  else {
    if (track.elevationCoverage < 1)
      reasons.push('A complete elevation profile is needed to estimate the climbing time.');
    if (track.hasGaps)
      reasons.push(
        'Use a continuous track without large GPS jumps before estimating a finish time.',
      );
  }
  if (evidence.length < 3)
    reasons.push(
      `Add ${3 - evidence.length} more usable past ${3 - evidence.length === 1 ? 'effort' : 'efforts'} with elevation and an elapsed time for a personal estimate. Choose running or hiking efforts on comparable terrain.`,
    );
  if (reasons.length || !track)
    return { estimate: null, estimateReasons: reasons, references: compared };
  const model = fit(evidence);
  const sectionSeconds = sectionTimes(track, terrain, sectionTerrain, model);
  const seconds = sectionSeconds.reduce((a, b) => a + b, 0);
  if (seconds > 20 * 86400)
    return {
      estimate: null,
      estimateReasons: [
        'This course is beyond the supported prediction range. Use shorter, comparable efforts.',
      ],
      references: compared,
    };
  const errors = compared
    .filter((r) => r.predictedSeconds !== null)
    .map((r) => Math.abs(r.predictedSeconds! - r.durationSeconds!) / r.durationSeconds!);
  const extrapolated =
    track.distanceMeters > Math.max(...evidence.map((r) => r.distanceMeters)) * 1.25 ||
    track.distanceMeters < Math.min(...evidence.map((r) => r.distanceMeters)) * 0.75;
  const margin = clamp(
    Math.max(0.15, ...errors) +
      (evidence.length < 4 ? 0.1 : 0) +
      (extrapolated ? 0.1 : 0) +
      (model.limitedClimbing ? 0.05 : 0),
    0.15,
    0.5,
  );
  const harder = sectionTimes(
    track,
    Math.min(5, terrain + 1),
    Object.fromEntries(
      Object.entries(sectionTerrain).map(([key, level]) => [key, Math.min(5, level + 1)]),
    ),
    model,
  ).reduce((a, b) => a + b, 0);
  const explanations = [
    `Based on ${evidence.length} usable efforts. This is a planning range, not a calibrated confidence interval or a guaranteed finish.`,
    'Elapsed reference times include pauses. The estimate reflects those habits; it does not add a separate aid-station stop budget.',
    'Terrain adds an illustrative 3.5% of base time per level. It is an editable difficulty assumption, not a measured surface classification.',
    'Distance is measured along the track. Elevation is resampled every 25 m and median-smoothed over five points; display simplification does not change the totals.',
  ];
  if (model.limitedClimbing)
    explanations.push(
      'These efforts have similar climbing per kilometre, so they cannot isolate climbing cost. A provisional 60 seconds per 100 m is used and the range is wider. Add more varied efforts.',
    );
  if (extrapolated)
    explanations.push(
      'This course is outside the distance range of your references, so the uncertainty range is wider.',
    );
  if (evidence.length < 4)
    explanations.push(
      'Three efforts provide only a starting estimate. Add a fourth for independent predicted-versus-actual checks.',
    );
  return {
    estimate: {
      seconds,
      lowSeconds: seconds * (1 - margin),
      highSeconds: seconds * (1 + margin),
      paceSecondsPerKm: model.pace,
      climbSecondsPer100m: model.climb,
      fatiguePerHour: model.fatigue,
      referenceCount: evidence.length,
      harderTerrainSeconds: terrain < 5 ? Math.max(0, harder - seconds) : null,
      sectionSeconds,
      explanations,
    },
    estimateReasons: [],
    references: compared,
  };
}
