import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleGetSegmentation } from '../../src/tools/get-segmentation.js';
import type { ClickyClient } from '../../src/clicky-client.js';

function clientCapturing() {
  let capturedArgs: unknown = null;
  const client: Partial<ClickyClient> = {
    getSegmentation: async (args) => {
      capturedArgs = args;
      return [];
    },
  };
  return { client: client as ClickyClient, getCaptured: () => capturedArgs as any };
}

function clientReturning(payload: unknown): ClickyClient {
  return { getSegmentation: async () => payload } as unknown as ClickyClient;
}

describe('handleGetSegmentation', () => {
  it('passes filter_key and filter_value through as filterKey/filterValue', async () => {
    const { client, getCaptured } = clientCapturing();
    await handleGetSegmentation(
      {
        filter_key: 'href',
        filter_value: 'https://warp.dev',
        segments: ['pages'],
        date_range: 'last-7-days',
      },
      client
    );
    const args = getCaptured();
    assert.equal(args.filterKey, 'href');
    assert.equal(args.filterValue, 'https://warp.dev');
    assert.deepEqual(args.segments, ['pages']);
  });

  it('builds date string from start_date + end_date', async () => {
    const { client, getCaptured } = clientCapturing();
    await handleGetSegmentation(
      {
        filter_key: 'goal',
        filter_value: 'warp_click_inline_cta',
        segments: ['visitors'],
        start_date: '2026-06-01',
        end_date: '2026-06-13',
      },
      client
    );
    assert.equal(getCaptured().date, '2026-06-01,2026-06-13');
  });

  it('passes a date_range keyword through unchanged', async () => {
    const { client, getCaptured } = clientCapturing();
    await handleGetSegmentation(
      { filter_key: 'goal', filter_value: 'x', segments: ['pages'], date_range: 'this-month' },
      client
    );
    assert.equal(getCaptured().date, 'this-month');
  });

  it('returns the client response serialised as JSON', async () => {
    const payload = [{ type: 'segmentation', dates: [{ date: 'last-7-days', items: [{ title: '/foo', value: '10' }] }] }];
    const result = await handleGetSegmentation(
      { filter_key: 'href', filter_value: 'https://warp.dev', segments: ['pages'], date_range: 'last-7-days' },
      clientReturning(payload)
    );
    assert.deepEqual(JSON.parse(result.content[0].text), payload);
  });

  it('throws when neither date form is provided', async () => {
    await assert.rejects(
      () =>
        handleGetSegmentation(
          { filter_key: 'href', filter_value: 'x', segments: ['pages'] } as any,
          clientReturning([])
        ),
      /Provide EITHER/
    );
  });

  it('throws when both date forms are provided', async () => {
    await assert.rejects(
      () =>
        handleGetSegmentation(
          {
            filter_key: 'href',
            filter_value: 'x',
            segments: ['pages'],
            start_date: '2026-06-01',
            end_date: '2026-06-13',
            date_range: 'last-7-days',
          },
          clientReturning([])
        ),
      /Provide EITHER/
    );
  });

  it('passes limit through to the client', async () => {
    const { client, getCaptured } = clientCapturing();
    await handleGetSegmentation(
      { filter_key: 'goal', filter_value: 'x', segments: ['pages'], date_range: 'last-7-days', limit: 100 },
      client
    );
    assert.equal(getCaptured().limit, 100);
  });
});
