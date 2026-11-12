import { expect, it } from 'vitest';
import { readUpload, uploadHandler } from '../../packages/host/src/upload-dispatch';
import { readJson } from '../../packages/host/src/http';

function request(file: string) {
  const data = new FormData();
  data.set('file', new File([file], 'course.gpx'));
  data.set('metadata', JSON.stringify({ raceId: 'synthetic' }));
  return new Request('http://localhost/upload', { method: 'POST', body: data });
}
it('reads exactly one bounded binary file and metadata without depending on Content-Length', async () => {
  expect(await readUpload(request('<gpx/>'), 32)).toEqual({
    file: { name: 'course.gpx', bytes: new TextEncoder().encode('<gpx/>') },
    metadata: { raceId: 'synthetic' },
  });
  await expect(readUpload(request('x'.repeat(33)), 32)).rejects.toThrow(/non-empty/);
  await expect(readUpload(request('x'.repeat(17000)), 32)).rejects.toThrow(/limit/);
});
it('rejects undeclared/inherited upload handlers and malformed multipart input', async () => {
  const plugins = {
    example: { operations: {}, uploads: { track: { maxBytes: 32, handle: async () => ({}) } } },
  };
  expect(uploadHandler(plugins, 'example', 'track').maxBytes).toBe(32);
  for (const name of ['constructor', 'toString', '__proto__', 'unknown'])
    expect(() => uploadHandler(plugins, 'example', name)).toThrow(/does not exist/);
  await expect(
    readUpload(new Request('http://localhost', { method: 'POST', body: 'bad' }), 32),
  ).rejects.toThrow();
  const duplicate = new FormData();
  duplicate.append('file', new File(['x'], 'x'));
  duplicate.append('file', new File(['y'], 'y'));
  duplicate.append('metadata', '{}');
  await expect(
    readUpload(new Request('http://localhost', { method: 'POST', body: duplicate }), 32),
  ).rejects.toThrow(/one file/);
});
it('retains existing JSON byte-limit and invalid-JSON behavior', async () => {
  expect(
    await readJson(new Request('http://localhost', { method: 'POST', body: '{"ok":true}' })),
  ).toEqual({ ok: true });
  await expect(
    readJson(new Request('http://localhost', { method: 'POST', body: 'bad' })),
  ).rejects.toThrow(/valid JSON/);
  await expect(
    readJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(12) }), 10),
  ).rejects.toThrow(/limit/);
});
