import { resolve } from 'node:path';
import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve('../..'),
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  experimental: { externalDir: true },
};
export default config;
