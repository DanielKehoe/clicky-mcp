import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleGetOutboundClickSources } from '../../src/tools/get-outbound-click-sources.js';
import type { ClickyClient } from '../../src/clicky-client.js';

function actionsResponse(items: unknown[]) {
  return [{ type: 'actions-list', dates: [{ date: 'test', items }] }];
}

function pagesResponse(items: unknown[]) {
  return [{ type: 'pages', dates: [{ date: 'test', items }] }];
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

  describe('strict method — goal fast path', () => {
    it('delegates to goal segmentation when goal is provided', async () => {
      let capturedArgs: unknown = null;
      const client: Partial<ClickyClient> = {
        getSegmentation: async (args) => {
          capturedArgs = args;
          return pagesResponse([
            { url: 'https://mac.install.guide/macos/download', value: '72' },
          ]);
        },
      };
      const result = await handleGetOutboundClickSources(
        {
          outbound_url: 'https://warp.dev/mac-terminal',
          goal: 'warp_click_inline_cta',
          method: 'strict',
          date_range: 'this-month',
        },
        client as ClickyClient
      );
      const args = capturedArgs as any;
      assert.equal(args.filterKey, 'goal');
      assert.equal(args.filterValue, 'warp_click_inline_cta');
      assert.deepEqual(args.segments, ['pages']);

      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.method, 'strict');
      assert.equal(parsed.attribution_source, 'goal');
      assert.equal(parsed.goal, 'warp_click_inline_cta');
      assert.equal(parsed.items[0].page, '/macos/download');
      assert.equal(parsed.items[0].clicks, 72);
      assert.equal(parsed.total_clicks, 72);
    });

    it('merges absolute and relative forms of the same page (the upgrade double-count)', async () => {
      const client: Partial<ClickyClient> = {
        getSegmentation: async () =>
          pagesResponse([
            { url: 'https://mac.install.guide/macos/upgrade', value: '81' },
            // relative form has only a title, no url — same page
            { title: '/macos/upgrade', value: '31' },
          ]),
      };
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', goal: 'warp_click_inline_cta', date_range: 'this-month' },
        client as ClickyClient
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items.length, 1, 'absolute + relative should merge to one page');
      assert.equal(parsed.items[0].page, '/macos/upgrade');
      assert.equal(parsed.items[0].clicks, 112);
    });

    it('sorts merged pages by clicks descending', async () => {
      const client: Partial<ClickyClient> = {
        getSegmentation: async () =>
          pagesResponse([
            { url: 'https://mac.install.guide/a', value: '10' },
            { url: 'https://mac.install.guide/b', value: '50' },
            { url: 'https://mac.install.guide/c', value: '30' },
          ]),
      };
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', goal: 'g', date_range: 'this-month' },
        client as ClickyClient
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.deepEqual(parsed.items.map((i: { clicks: number }) => i.clicks), [50, 30, 10]);
    });
  });

  describe('strict method — action-log walk', () => {
    it('attributes a click to the preceding pageview in the same session', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '1000', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '1000', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 'sess1', time: '900', action_type: 'pageview', action_url: 'https://mac.install.guide/download' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.method, 'strict');
      assert.equal(parsed.attribution_source, 'action-log');
      assert.equal(parsed.total_clicks, 1);
      assert.equal(parsed.unattributed, 0);
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].page, '/download');
      assert.equal(parsed.items[0].clicks, 1);
    });

    it('normalizes absolute and relative source pages so they merge', async () => {
      const clickPage = actionsResponse([
        { session_id: 's1', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 's2', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 's1', time: '200', action_type: 'pageview', action_url: 'https://mac.install.guide/macos/upgrade' },
        { session_id: 's1', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 's2', time: '200', action_type: 'pageview', action_url: '/macos/upgrade' },
        { session_id: 's2', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([clickPage, allPage])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].page, '/macos/upgrade');
      assert.equal(parsed.items[0].clicks, 2);
    });

    it('marks click as unattributed when no preceding pageview exists', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', action_url: 'https://warp.dev' },
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
        { session_id: 'sess1', time: '200', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 'sess1', time: '500', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      // newest-first ordering, as the real API returns
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '500', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 'sess1', time: '300', action_type: 'pageview', action_url: '/page-b' },
        { session_id: 'sess1', time: '200', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 'sess1', time: '100', action_type: 'pageview', action_url: '/page-a' },
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

    it('skips click and outbound actions when walking back for the source page', async () => {
      const clickPage = actionsResponse([
        { session_id: 'sess1', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 'sess1', time: '300', action_type: 'outbound', action_url: 'https://warp.dev' },
        // a tracked on-page "click" goal — pseudo-URL, NOT the source page
        { session_id: 'sess1', time: '250', action_type: 'click', action_url: 'https://mac.install.guide/Warp+click' },
        { session_id: 'sess1', time: '100', action_type: 'pageview', action_url: '/real-source' },
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
        { session_id: 'sess1', time: '500', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const fullPage1Items = Array.from({ length: 1000 }, (_, i) => ({
        session_id: `other-${i}`,
        time: String(i),
        action_type: 'pageview',
        action_url: `/page-${i}`,
      }));
      const fullPage1 = actionsResponse(fullPage1Items);
      const fullPage2 = actionsResponse([
        { session_id: 'sess1', time: '500', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 'sess1', time: '400', action_type: 'pageview', action_url: '/source-page' },
      ]);

      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient([filteredPage1, fullPage1, fullPage2])
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items[0].page, '/source-page');
      assert.equal(parsed.pages_fetched, 2);
    });

    it('flags truncated and reports pages_fetched when the page cap is hit', async () => {
      const filteredPage = actionsResponse([
        { session_id: 'sess1', time: '100', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const fullPage = actionsResponse(
        Array.from({ length: 1000 }, (_, i) => ({
          session_id: `s${i}`,
          time: String(i + 1000),
          action_type: 'pageview',
          action_url: `/p${i}`,
        }))
      );

      // 1 filtered call + 20 unfiltered pages (the cap) all returning 1000 items
      const responses = [filteredPage, ...Array.from({ length: 20 }, () => fullPage)];
      const result = await handleGetOutboundClickSources(
        { outbound_url: 'https://warp.dev', method: 'strict', date_range: 'last-7-days' },
        makeClient(responses)
      );
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.truncated, true);
      assert.ok(parsed.truncation_warning.includes('20'), 'warning should mention the page cap');
      assert.ok(parsed.truncation_warning.includes('goal'), 'warning should point to the goal fast path');
      assert.equal(parsed.pages_fetched, 20);
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
        { session_id: 's1', time: '100', action_type: 'outbound', action_url: 'https://warp.dev' },
      ]);
      const allPage = actionsResponse([
        { session_id: 's1', time: '100', action_type: 'outbound', action_url: 'https://warp.dev' },
        { session_id: 's1', time: '50', action_type: 'pageview', action_url: '/home' },
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
