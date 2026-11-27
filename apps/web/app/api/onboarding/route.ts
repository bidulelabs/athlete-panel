import { onboardingStatusSchema } from '@athlete-panel/contracts';
import { cookies } from 'next/headers';
import { requireSession, SESSION_COOKIE } from '../../../../../packages/host/src/auth';
import { connection } from '../../../../../packages/host/src/db';
import { readOnboarding } from '../../../../../packages/host/src/onboarding';
import { failure, contractJson } from '../../../../../packages/host/src/http';
import { pluginEnabled } from '../../../../../packages/host/src/plugins';
import { status } from '../../../../../plugins/garmin/public/server';
import { readActivitySources } from '../../../../../instance/activity-sources';

export async function GET() {
  try {
    await requireSession((await cookies()).get(SESSION_COOKIE)?.value);
    const [worker] = await connection()<
      { value: unknown }[]
    >`select value from host.settings where key='worker'`;
    const garmin = pluginEnabled('garmin')
      ? await status(false)
      : { connected: false, paused: false, lastError: null };
    const [onboarding, activitySources] = await Promise.all([
      readOnboarding(),
      readActivitySources(garmin.connected),
    ]);
    return contractJson(onboardingStatusSchema, {
      onboarding,
      worker: worker?.value ?? null,
      garmin,
      activitySources,
    });
  } catch (error) {
    return failure(error);
  }
}
