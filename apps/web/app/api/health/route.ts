import { checkSchema } from '../../../../../packages/host/src/schema';
export async function GET() {
  try {
    await checkSchema();
    const database = new URL(process.env.DATABASE_URL!);
    const synthetic =
      process.env.ATHLETE_PANEL_E2E === 'true' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) &&
      database.pathname.endsWith('_test');
    return Response.json(
      { status: 'ready', ...(synthetic ? { testInstance: 'isolated-synthetic' } : {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
