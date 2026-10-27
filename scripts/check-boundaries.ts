import { checkBoundaries } from './lib/import-boundaries';
const errors = checkBoundaries(process.cwd());
if (errors.length) throw new Error(errors.join('\n'));
console.log('Resolved browser, host and public plugin dependency boundaries checked.');
