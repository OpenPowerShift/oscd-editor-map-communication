// Regenerates demo/sample.scd from the deterministic test generator.
// Usage: npm run build && node scripts/generate-sample.mjs
import { writeFileSync } from 'node:fs';

import { generateScd } from '../dist/testing/generate-scd.js';

writeFileSync(
  new URL('../demo/sample.scd', import.meta.url),
  generateScd({ bays: 6, baysPerRow: 3 }),
);
