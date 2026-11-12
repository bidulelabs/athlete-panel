/** Human-readable audit heading; subject selection belongs to the training read service. */
export function auditTitle(summary: string, subject?: string) {
  if (summary.startsWith('Undo:')) return 'Reverted training changes';
  if (summary === 'workout.reorder') return 'Reordered workouts';
  const verbs: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    duplicate: 'Duplicated',
    complete: 'Logged',
    clearCompletion: 'Cleared completion for',
    link: 'Linked an activity to',
    autoLink: 'Automatically linked Garmin activity to',
    unlink: 'Unlinked an activity from',
  };
  const verb = verbs[summary.split('.')[1] ?? ''];
  if (verb && subject) return `${verb} ${subject}`;
  return summary.trim() && !/\b(?:profile|plan|workout|note|event|injury)\.[a-zA-Z]+/.test(summary)
    ? summary
    : 'Updated training';
}
