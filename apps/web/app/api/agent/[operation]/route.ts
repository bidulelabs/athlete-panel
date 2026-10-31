import { readHistory } from '../../../../../../plugins/agent-bridge/history';
import { contextForToken, submitProposal } from '../../../../../../plugins/agent-bridge/service';
import { pluginEnabled } from '../../../../../../packages/host/src/plugins';
import { failure, json, readJson } from '../../../../../../packages/host/src/http';
import { assert } from '../../../../../../packages/host/src/errors';
import { checkSchema } from '../../../../../../packages/host/src/schema';
import { loginClient } from '../../../../../../packages/host/src/auth';
import {
  startConnection,
  pollConnection,
  cancelConnection,
} from '../../../../../../plugins/agent-bridge/connections';
import { AGENT_PROPOSAL_BYTES } from '../../../../../../packages/contracts/src';
async function dispatch(request: Request, operation: string) {
  try {
    assert(pluginEnabled('agent-bridge'), 'plugin_disabled', 'Agent access is disabled.', 404);
    await checkSchema();
    if (operation === 'connect' && request.method === 'POST') {
      // Enrollment is public, but cannot grant access. Disallow cross-origin browser initiation.
      assert(
        !request.headers.has('origin'),
        'invalid_origin',
        'Start the connection from the local CLI.',
        403,
      );
      return json(await startConnection(await readJson(request), loginClient(request)));
    }
    const auth = request.headers.get('authorization');
    assert(
      auth && auth.startsWith('Bearer '),
      'unauthorized',
      'A scoped agent grant is required.',
      401,
    );
    const token = auth.slice(7);
    assert(
      /^[A-Za-z0-9_-]{43}$/.test(token),
      'unauthorized',
      'A valid agent credential is required.',
      401,
    );
    if (operation === 'connect' && request.method === 'GET')
      return json(await pollConnection(token));
    if (operation === 'connect-cancel' && request.method === 'POST')
      return json(await cancelConnection(token));
    if (
      ['history-discover', 'history-summary', 'history-records', 'history-context'].includes(
        operation,
      ) &&
      request.method === 'POST'
    )
      return json(
        await readHistory(
          token,
          operation.slice(8) as 'discover' | 'summary' | 'records' | 'context',
          await readJson(request),
        ),
      );
    if (operation === 'context' && request.method === 'GET')
      return json(await contextForToken(token));
    if (operation === 'propose' && request.method === 'POST')
      return json(await submitProposal(token, await readJson(request, AGENT_PROPOSAL_BYTES)));
    return json(
      {
        error: {
          code: 'forbidden',
          message: 'Agent grants support context and proposal submission only.',
        },
      },
      403,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  return dispatch(request, (await params).operation);
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  return dispatch(request, (await params).operation);
}
