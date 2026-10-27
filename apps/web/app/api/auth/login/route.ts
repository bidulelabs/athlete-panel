import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  login,
  loginClient,
  requireOrigin,
  SESSION_COOKIE,
} from '../../../../../../packages/host/src/auth';
import { failure, json, readJson } from '../../../../../../packages/host/src/http';
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { password } = z
      .object({ password: z.string().max(256) })
      .strict()
      .parse(await readJson(request));
    const token = await login(password, loginClient(request));
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE !== 'false',
      sameSite: 'strict',
      path: '/',
      maxAge: 604800,
    });
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
