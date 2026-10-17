import assert from 'node:assert/strict';
import { MCP_GSC_MAX_RANGE_DAYS, mcpDefaultGscRange, mcpInclusiveDays } from '@cerevex/contracts';
import { gscSyncSpan } from '../src/lib/gsc/client';

const NOW = Date.UTC(2026, 9, 17, 15, 0, 0);

const span = gscSyncSpan(28, NOW);
const range = mcpDefaultGscRange(NOW);
const stored = { date_start: span.dateStart, date_end: span.dateEnd };
assert.equal(MCP_GSC_MAX_RANGE_DAYS, 28);
assert.equal(mcpInclusiveDays(stored.date_start, stored.date_end), 28);
assert.deepEqual(span, { dateStart: range.dateStart, dateEnd: range.dateEnd });
assert.equal(stored.date_start, '2026-09-20');
assert.equal(stored.date_end, '2026-10-17');

console.log('gsc-sync-span: ok');
