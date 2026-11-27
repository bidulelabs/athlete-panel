import { assert } from '../../../../../../packages/host/src/errors';
import { failure } from '../../../../../../packages/host/src/http';
import { pluginEnabled } from '../../../../../../packages/host/src/plugins';
import { checkSchema } from '../../../../../../packages/host/src/schema';

export async function POST(request: Request) {
  try {
    assert(
      pluginEnabled('apple-health'),
      'plugin_disabled',
      'Apple Health import is disabled.',
      404,
    );
    await checkSchema();
    const { receiveAppleUpload } =
      await import('../../../../../../plugins/apple-health/public/server');
    await receiveAppleUpload(request);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
