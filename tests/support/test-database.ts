export function isolatedDatabaseUrl(
  variable: 'TEST_DATABASE_URL' | 'E2E_DATABASE_URL' = 'TEST_DATABASE_URL',
): string {
  const supplied = process.env[variable];
  if (!supplied)
    throw new Error(`Set ${variable} to a loopback database whose name ends in _test.`);
  const url = new URL(supplied);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(`${variable} must point to a loopback database whose name ends in _test.`);
  return supplied;
}
