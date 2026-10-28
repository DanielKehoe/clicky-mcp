import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleGetNewVsReturning } from '../../src/tools/get-new-vs-returning.js';
import type { ClickyClient } from '../../src/clicky-client.js';

function clientReturning(payload: unknown): ClickyClient {
  return {
    getNewVsReturning: async () => payload,
  } as unknown as ClickyClient;
}

const entry = (type: string, value: string) => ({
  type,
  dates: [{ date: '2024-01-01,2024-01-31', items: [{ value }] }],
});

describe('handleGetNewVsReturning', () => {
  it('computes returning visits and shares from the three Clicky types', async () => {
    const payload = [
      entry('visitors', '1000'),
      entry('visitors-unique', '800'),
      entry('visitors-new', '700'),
    ];
    const result = await handleGetNewVsReturning(
      { date_range: 'last-month' },
      clientReturning(payload)
    );
    assert.deepEqual(JSON.parse(result.content[0].text), {
      date: '2024-01-01,2024-01-31',
      visits: 1000,
      unique_visitors: 800,
      new_visitors: 700,
      returning_visits: 300,
      returning_visit_share_pct: 30,
      new_share_of_unique_pct: 87.5,
    });
  });

  it('passes the raw response through when a needed type is missing', async () => {
    const payload = [entry('visitors', '1000')];
    const result = await handleGetNewVsReturning(
      { date_range: 'last-month' },
      clientReturning(payload)
    );
    assert.deepEqual(JSON.parse(result.content[0].text), payload);
  });

  it('passes an error-shaped response through unchanged', async () => {
    const payload = { error: 'Invalid site ID' };
    const result = await handleGetNewVsReturning(
      { date_range: 'last-month' },
      clientReturning(payload)
    );
    assert.deepEqual(JSON.parse(result.content[0].text), payload);
  });
});
