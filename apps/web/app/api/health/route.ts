import { isIsolatedTestInstance } from '../../../../../packages/host/src/db';
import { checkSchema } from '../../../../../packages/host/src/schema';
export async function GET() {
  try {
    await checkSchema();
    return Response.json(
      {
        status: 'ready',
        ...(isIsolatedTestInstance() ? { testInstance: 'isolated-synthetic' } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
