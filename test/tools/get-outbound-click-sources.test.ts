import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleGetOutboundClickSources } from '../../src/tools/get-outbound-click-sources.js';
import type { ClickyClient } from '../../src/clicky-client.js';

function actionsResponse(items: unknown[]) {
  return [{ type: 'actions-list', dates: [{ date: 'test', items }] }];
}

function makeClient(responses: unknown[]): ClickyClient {
  let i = 0;
  return {
    getActionsList: async () => responses[i++] ?? actionsResponse([]),
    getSegmentation: async () => [],
  } as unknown as ClickyClient;
}

describe('handleGetOutboundClickSources', () => {
  describe('session method', () => {
    it('delegates to getSegmentation and includes co-occurrence note', async () => {
      let capturedArgs: unknown = null;
      const client: Partial<ClickyClient> = {
        getSegmentation: async (args) => { capturedArgs = args; return []; },
      };
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'session', date_range: 'last-7-days' },
        client as ClickyClient
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.method, 'session');
      assert.ok(typeof parsed.note === 'string' && parsed.note.includes('co-occurrence'));
      const args = capturedArgs as any;
      assert.equal(args.filterKey, 'href');
      assert.equal(args.filterValue, 'https://warp.dev');
      assert.deepEqual(args.segments, ['pages']);
    });

    it('defaults limit to 50 when omitted', async () => {
      let capturedArgs: unknown = null;
      const client: Partial<ClickyClient> = {
        getSegmentation: async (args) => { capturedArgs = args; return []; },
      };
      await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'session', date_range: 'last-7-days' },
        client as ClickyClient
      );
      assert.equal((capturedArgs as any).limit, 50);
    });
  });

  describe('strict method', () => {
    it('attributes a click to the preceding pageview in the same session', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '1000', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '900', action_type: 'pageview', url: '/download' },
        { session_id: 'sess1', time: '1000', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.method, 'strict');
      assert.equal(parsed.total_clicks, 1);
      assert.equal(parsed.unattributed, 0);
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].page, '/download');
      assert.equal(parsed.items[0].clicks, 1);
    });

    it('marks click as unattributed when no preceding pageview exists', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.total_clicks, 1);
      assert.equal(parsed.unattributed, 1);
      assert.equal(parsed.items.length, 0);
    });

    it('attributes multiple clicks in one session to their respective preceding pages', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '200', action_type: 'outbound', url: 'https://warp.dev' },
        { session_id: 'sess1', time: '500', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'pageview', url: '/page-a' },
        { session_id: 'sess1', time: '200', action_type: 'outbound', url: 'https://warp.dev' },
        { session_id: 'sess1', time: '300', action_type: 'pageview', url: '/page-b' },
        { session_id: 'sess1', time: '500', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.total_clicks, 2);
      assert.equal(parsed.unattributed, 0);
      const pageA = parsed.items.find((i: { page: string }) => i.page === '/page-a');
      const pageB = parsed.items.find((i: { page: string }) => i.page === '/page-b');
      assert.ok(pageA && pageA.clicks === 1);
      assert.ok(pageB && pageB.clicks === 1);
    });

    it('skips goal and event actions when walking back for source page', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '300', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'pageview', url: '/real-source' },
        { session_id: 'sess1', time: '200', action_type: 'goal', url: 'warp_click_inline_cta' },
        { session_id: 'sess1', time: '300', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items[0].page, '/real-source');
    });

    it('stitches action log across multiple pages of unfiltered results', async () => {
      const filteredPage1 = actionsResponse([
        { session_id: 'sess1', time: '500', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      // First unfiltered page: 1000 items → triggers page 2
      const fullPage1Items = Array.from({ length: 1000 }, (_, i) => ({
        session_id: `other-${i}`,
        time: String(i),
        action_type: 'pageview',
        url: `/page-${i}`,
      }));
      const fullPage1 = actionsResponse(fullPage1Items);
      // Second unfiltered page: has the click session
      const fullPage2 = actionsResponse([
        { session_id: 'sess1', time: '400', action_type: 'pageview', url: '/source-page' },
        { session_id: 'sess1', time: '500', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([filteredPage1, fullPage1, fullPage2])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items[0].page, '/source-page');
      assert.equal(parsed.pages_fetched, 2);
    });

    it('adds a truncation warning and reports pages_fetched when page cap is hit', async () => {
      const filteredPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      // All unfiltered pages return 1000 items — never terminates naturally
      const fullPage = actionsResponse(
        Array.from({ length: 1000 }, (_, i) => ({
          session_id: `s${i}`,
          time: String(i + 1000),
          action_type: 'pageview',
          url: `/p${i}`,
        }))
      );

      // 1 filtered call + 35 unfiltered pages = 36 total
      const responses = [filteredPage, ...Array.from({ length: 35 }, () => fullPage)];
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient(responses)
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.ok(parsed.truncation_warning, 'should surface a truncation warning');
      assert.ok(parsed.truncation_warning.includes('35'), 'warning should mention the page cap');
      assert.equal(parsed.pages_fetched, 35);
    });

    it('returns an empty result when no clicks match the outbound URL', async () => {
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://never-clicked.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([actionsResponse([])])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.total_clicks, 0);
      assert.equal(parsed.items.length, 0);
      assert.equal(parsed.pages_fetched, 0);
    });

    it('defaults to strict method when method is omitted', async () => {
      const clickPage = actionsResponse([
        { session_id: 's1', time: '100', action_type: 'outbound', url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 's1', time: '50', action_type: 'pageview', url: '/home' },
        { session_id: 's1', time: '100', action_type: 'outbound', url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.method, 'strict');
    });
  });
});
