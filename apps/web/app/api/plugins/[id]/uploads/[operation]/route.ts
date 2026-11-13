import { cookies } from 'next/headers';
import { servers } from '../../../../../../../../instance/registry.server';
import {
  requireSession,
  requireOrigin,
  SESSION_COOKIE,
} from '../../../../../../../../packages/host/src/auth';
import { failure, json } from '../../../../../../../../packages/host/src/http';
import { pluginEnabled } from '../../../../../../../../packages/host/src/plugins';
import { assert } from '../../../../../../../../packages/host/src/errors';
import {
  readUpload,
  uploadHandler,
} from '../../../../../../../../packages/host/src/upload-dispatch';
import type { ServerPlugin } from '../../../../../../../../packages/plugin-sdk/src';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; operation: string }> },
) {
  try {
    requireOrigin(request);
    await requireSession((await cookies()).get(SESSION_COOKIE)?.value);
    const { id, operation } = await params;
    assert(pluginEnabled(id), 'plugin_disabled', 'This plugin is not enabled.', 404);
    const upload = uploadHandler(servers as Record<string, ServerPlugin>, id, operation);
    const { file, metadata } = await readUpload(request, upload.maxBytes);
    return json(await upload.handle(file, metadata, { actor: 'owner' }));
  } catch (error) {
    return failure(error);
  }
}
