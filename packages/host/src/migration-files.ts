/** Ordered host migrations shared by generation and execution. Applied files are immutable. */
export const hostMigrationFiles = [
  'packages/host/migrations/001-host.sql',
  'packages/host/migrations/002-job-priority.sql',
] as const;
