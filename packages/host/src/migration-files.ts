/** Ordered host migrations shared by generation and execution. Applied files are immutable. */
export const hostMigrationFiles = [
  'packages/host/migrations/001-host.sql',
  'packages/host/migrations/002-job-priority.sql',
  'packages/host/migrations/003-request-budgets.sql',
  'packages/host/migrations/004-password-upgrade.sql',
] as const;
