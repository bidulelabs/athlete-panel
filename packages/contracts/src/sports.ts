import snapshot from './garmin-activity-types.json' with { type: 'json' };

/** Pinned provider metadata. Labels are presentation; keys and parent IDs are identity. */
export const SPORT_CATALOG_VERSION = snapshot.retrievedAt;
export const SPORT_CATALOG_SOURCE = snapshot.source;
export const garminSportTypes = snapshot.types;
const byKey = new Map(garminSportTypes.map((type) => [type.typeKey, type]));
const byId = new Map(garminSportTypes.map((type) => [type.typeId, type]));
export type GarminSportType = (typeof garminSportTypes)[number];
export type SportSelection = {
  sport: string | null;
  sportSubgroup?: string | null;
  sportResolution?: 'resolved' | 'unresolved';
};
export type GarminActivityType = {
  typeKey: string;
  typeId: string | null;
  parentTypeId: string | null;
};

export function sportGroup(typeKey: string): GarminSportType | undefined {
  let type = byKey.get(typeKey);
  const visited = new Set<string>();
  while (type && type.parentTypeId !== '17') {
    if (visited.has(type.typeId)) return undefined;
    visited.add(type.typeId);
    type = byId.get(type.parentTypeId);
  }
  return type;
}

export const sportGroups = garminSportTypes.filter((type) => type.parentTypeId === '17');
export function sportSubgroups(group: string): GarminSportType[] {
  return garminSportTypes.filter(
    (type) => type.typeKey !== group && sportGroup(type.typeKey)?.typeKey === group,
  );
}
export function validSportSelection(value: SportSelection): boolean {
  if (!value.sport || !sportGroups.some((group) => group.typeKey === value.sport)) return false;
  return (
    !value.sportSubgroup ||
    (value.sportSubgroup !== value.sport &&
      sportGroup(value.sportSubgroup)?.typeKey === value.sport)
  );
}

/** Unknown or conflicting provider metadata is retained, never guessed from an activity name. */
export function classifyGarminSport(source: GarminActivityType): SportSelection & {
  sport: string;
  sportResolution: 'resolved' | 'unresolved';
} {
  const type = byKey.get(source.typeKey);
  const group = sportGroup(source.typeKey);
  if (
    !type ||
    !group ||
    (source.typeId !== null && source.typeId !== type.typeId) ||
    (source.parentTypeId !== null && source.parentTypeId !== type.parentTypeId)
  ) {
    return { sport: source.typeKey, sportSubgroup: null, sportResolution: 'unresolved' };
  }
  return {
    sport: group.typeKey,
    sportSubgroup: group.typeKey === type.typeKey ? null : type.typeKey,
    sportResolution: 'resolved',
  };
}

export function canLinkSport(workout: SportSelection, activity: SportSelection): boolean {
  if (
    activity.sportResolution === 'unresolved' ||
    !validSportSelection(workout) ||
    !validSportSelection(activity) ||
    workout.sport !== activity.sport
  )
    return false;
  // The legacy catch-all lost its original identity. Other is never a wildcard.
  if (activity.sport === 'other' && activity.sportResolution !== 'resolved') return false;
  return !workout.sportSubgroup || workout.sportSubgroup === activity.sportSubgroup;
}

const labels: Record<string, string> = {
  fitness_equipment: 'Gym & fitness',
  multi_sport: 'Multisport',
  para_sports: 'Para sports',
  lap_swimming: 'Pool swimming',
  street_running: 'Road running',
  cross_country_skiing_ws: 'Cross-country skiing',
  skate_skiing_ws: 'Skate skiing',
  backcountry_skiing: 'Ski touring',
  paddelball: 'Padel',
};
export function sportTypeLabel(key: string | null | undefined): string {
  if (!key) return 'Rest';
  return (
    labels[key] ??
    key
      .replace(/_v\d+$/, '')
      .replace(/_ws$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function isUnresolvedActivitySport(value: SportSelection): boolean {
  return (
    value.sportResolution === 'unresolved' ||
    ('provider' in value && value.sport === 'other' && value.sportResolution === undefined)
  );
}
export function sportSelectionLabel(value: SportSelection): string {
  const label = value.sportSubgroup
    ? `${sportTypeLabel(value.sport)} · ${sportTypeLabel(value.sportSubgroup)}`
    : sportTypeLabel(value.sport);
  return isUnresolvedActivitySport(value) ? `${label} (unresolved)` : label;
}
export function isRest(value: { kind?: string }): boolean {
  return value.kind === 'rest';
}
