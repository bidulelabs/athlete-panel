'use client';

import { activityProviderLabel, isRest, type Workout } from '@athlete-panel/contracts';
import { Circle, CircleCheck, CircleDashed, CircleMinus, Link2, Pause } from 'lucide-react';
import './completion-state.css';

export function WorkoutStatus({ workout }: { workout: Workout }) {
  const status = isRest(workout) ? 'rest' : (workout.completion?.status ?? 'planned');
  const Icon = {
    rest: Pause,
    planned: Circle,
    completed: CircleCheck,
    partial: CircleDashed,
    skipped: CircleMinus,
  }[status];
  return (
    <span className={`workout-status workout-status-${status}`}>
      <Icon size={15} aria-hidden="true" />
      {status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

export function WorkoutSource({ workout }: { workout: Workout }) {
  if (!workout.completion || workout.completion.status === 'skipped') return null;
  return (
    <span className="workout-source">
      {workout.completion.source !== 'manual' ? (
        <>
          <Link2 size={14} aria-hidden="true" />
          {activityProviderLabel(workout.completion.source)} linked
        </>
      ) : (
        'Logged manually'
      )}
    </span>
  );
}
