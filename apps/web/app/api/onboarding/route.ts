import { cookies } from 'next/headers';
import { requireSession, SESSION_COOKIE } from '../../../../../packages/host/src/auth';
import { connection } from '../../../../../packages/host/src/db';
import { readOnboarding } from '../../../../../packages/host/src/onboarding';
import { failure, json } from '../../../../../packages/host/src/http';
import { pluginEnabled } from '../../../../../packages/host/src/plugins';
import { status } from '../../../../../plugins/garmin/service';

export async function GET() {
  try {
    await requireSession((await cookies()).get(SESSION_COOKIE)?.value);
    const [worker] = await connection()`select value from host.settings where key='worker'`;
    return json({
      onboarding: await readOnboarding(),
      worker: worker?.value ?? null,
      garmin: pluginEnabled('garmin')
        ? await status(false)
        : { connected: false, paused: false, lastError: null },
    });
  } catch (error) {
    return failure(error);
  }
}
