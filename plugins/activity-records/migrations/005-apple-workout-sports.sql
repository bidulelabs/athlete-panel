-- Sync for Health v1 identifiers that earlier imports left unresolved.
WITH sports (workout_type, sport) AS (
  VALUES
    ('swim_bike_run', 'multi_sport'),
    ('other', 'other'), ('water_sports', 'water_sports'),
    ('hand_cycling', 'cycling'),
    ('dance', 'fitness_equipment'), ('elliptical', 'fitness_equipment'),
    ('jump_rope', 'fitness_equipment'), ('pilates', 'fitness_equipment'),
    ('stair_climbing', 'fitness_equipment'),
    ('archery', 'other'), ('boxing', 'other'), ('golf', 'other'), ('hunting', 'other'),
    ('badminton', 'racket_sports'), ('pickleball', 'racket_sports'),
    ('racquetball', 'racket_sports'), ('squash', 'racket_sports'), ('table_tennis', 'racket_sports'),
    ('american_football', 'team_sports'), ('baseball', 'team_sports'), ('basketball', 'team_sports'),
    ('cricket', 'team_sports'), ('lacrosse', 'team_sports'), ('rugby', 'team_sports'),
    ('soccer', 'team_sports'), ('softball', 'team_sports'), ('volleyball', 'team_sports')
)
UPDATE activity_records.records AS record
SET revision = revision + 1, updated_at = now(),
  data = data || jsonb_build_object(
    'revision', revision + 1, 'sport', sports.sport, 'sportResolution', 'resolved',
    'sportSubgroup', CASE WHEN sports.workout_type <> 'swim_bike_run' THEN nullif(sports.workout_type, sports.sport) END,
    'title', CASE WHEN sports.workout_type = 'swim_bike_run' AND data->>'title' = 'Swim bike run'
      THEN 'Multisport' ELSE data->>'title' END
  )
FROM sports
WHERE record.kind = 'activity' AND NOT record.deleted AND data->>'provider' = 'apple-health'
  AND data->>'sportResolution' = 'unresolved'
  AND data#>>'{appleHealth,workoutType}' = sports.workout_type;
