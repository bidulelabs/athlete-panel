import { performance } from 'node:perf_hooks';
import { platform, arch } from 'node:os';
import {
  passwordHashAsync,
  verifyPasswordAsync,
  PASSWORD_PARAMETERS,
} from '../packages/host/src/crypto';

// Synthetic-only, non-gating benchmark: no configured owner or database access.
const password = 'synthetic-password-benchmark-only';
const encoded = await passwordHashAsync(password);
const samples: number[] = [];
for (let i = 0; i < 5; i++) {
  const started = performance.now();
  await verifyPasswordAsync(password, encoded);
  samples.push(Math.round(performance.now() - started));
}
const started = performance.now();
await Promise.all([verifyPasswordAsync(password, encoded), verifyPasswordAsync(password, encoded)]);
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: platform(),
      arch: arch(),
      parameters: PASSWORD_PARAMETERS,
      singleCheckMs: samples,
      twoConcurrentChecksMs: Math.round(performance.now() - started),
      processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    },
    null,
    2,
  ),
);
