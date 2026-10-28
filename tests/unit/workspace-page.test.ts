import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../packages/host/src/errors';

const requireSession = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect ${url}`);
});
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'token' }) }) }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('../../apps/web/app/workspace', () => ({ default: () => null }));
vi.mock('../../packages/host/src/auth', () => ({ requireSession, SESSION_COOKIE: 'session' }));
const { default: Page } = await import('../../apps/web/app/[...path]/page');

const open = (path: string[]) =>
  Page({ params: Promise.resolve({ path }), searchParams: Promise.resolve({}) });

describe('workspace page session check', () => {
  beforeEach(() => {
    requireSession.mockReset();
    redirect.mockClear();
  });

  it('sends an expired session to sign-in', async () => {
    requireSession.mockRejectedValue(new AppError('unauthorized', 'Sign in again.', 401));
    await expect(open(['calendar'])).rejects.toThrow('redirect /login');
  });

  it('lets a database outage reach the error page instead of sign-in', async () => {
    requireSession.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    await expect(open(['calendar'])).rejects.toThrow('ECONNREFUSED');
    expect(redirect).not.toHaveBeenCalled();
  });
});
