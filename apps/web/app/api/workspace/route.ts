import { cookies } from 'next/headers';
import { readWorkspaceResponse } from '../../../../../instance/workspace-response';
import { dateSchema } from '../../../../../packages/contracts/src';
import { requireSession, SESSION_COOKIE } from '../../../../../packages/host/src/auth';
import { assert } from '../../../../../packages/host/src/errors';
import { failure, json } from '../../../../../packages/host/src/http';
export async function GET(request: Request) {
  try {
    await requireSession((await cookies()).get(SESSION_COOKIE)?.value);
    const url = new URL(request.url);
    const from = dateSchema.parse(url.searchParams.get('from')),
      to = dateSchema.parse(url.searchParams.get('to'));
    assert(
      from <= to && Date.parse(to) - Date.parse(from) <= 121 * 86400000,
      'invalid_range',
      'Choose a date range of at most 121 days.',
    );
    return json(await readWorkspaceResponse({ from, to }));
  } catch (e) {
    return failure(e);
  }
}
