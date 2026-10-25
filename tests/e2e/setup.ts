import type { FullConfig } from '@playwright/test';

export default async function setup(config: FullConfig) {
  const origin = config.projects[0].use.baseURL!;
  const response = await fetch(`${origin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  const status = await response.json();
  if (!response.ok || status.testInstance !== 'isolated-synthetic') {
    throw new Error('Refusing browser mutations: start an isolated loopback *_test server with ATHLETE_PANEL_E2E=true. The owner instance must never be used.');
  }
}
