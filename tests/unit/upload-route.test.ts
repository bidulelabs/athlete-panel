import { beforeEach, expect, it, vi } from 'vitest';

const enabled = vi.fn();
const handle = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'synthetic' }) }) }));
vi.mock('../../packages/host/src/auth', () => ({
  requireOrigin: vi.fn(),
  requireSession: vi.fn(),
  SESSION_COOKIE: 'session',
}));
vi.mock('../../packages/host/src/plugins', () => ({ pluginEnabled: enabled }));
vi.mock('../../instance/registry.server', () => ({
  servers: { example: { operations: {}, uploads: { track: { maxBytes: 32, handle } } } },
}));
const { POST } = await import('../../apps/web/app/api/plugins/[id]/uploads/[operation]/route');
const context = { params: Promise.resolve({ id: 'example', operation: 'track' }) };
beforeEach(() => {
  enabled.mockReturnValue(true);
  handle.mockReset();
});

it('rejects a compiled disabled plugin before reading the uploaded body or invoking its handler', async () => {
  enabled.mockReturnValue(false);
  const response = await POST(
    new Request('http://localhost/upload', { method: 'POST', body: 'invalid multipart' }),
    context,
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'plugin_disabled' } });
  expect(handle).not.toHaveBeenCalled();
});
it('passes bounded bytes and owner context only to the registered upload operation', async () => {
  handle.mockResolvedValue({ revision: 1 });
  const form = new FormData();
  form.set('file', new File(['<gpx/>'], 'synthetic.gpx'));
  form.set('metadata', '{"purpose":"course"}');
  const response = await POST(
    new Request('http://localhost/upload', { method: 'POST', body: form }),
    context,
  );
  expect(response.status).toBe(200);
  expect(handle).toHaveBeenCalledWith(
    { name: 'synthetic.gpx', bytes: new TextEncoder().encode('<gpx/>') },
    { purpose: 'course' },
    { actor: 'owner' },
  );
});
