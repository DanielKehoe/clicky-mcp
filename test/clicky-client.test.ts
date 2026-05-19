import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClickyClient } from '../src/clicky-client.js';
import { makeStubAxios } from './helpers/stub-axios.js';

const SITE_ID = 'test-site';
const SITE_KEY = 'test-key';

function newClient(response: unknown = []) {
  const stub = makeStubAxios(response);
  const client = new ClickyClient({
    siteId: SITE_ID,
    siteKey: SITE_KEY,
    httpClient: stub.instance,
  });
  return { client, stub };
}

describe('ClickyClient', () => {
  describe('getTotalVisitors', () => {
    it('sends type=visitors with auth + date + json output', async () => {
      const { client, stub } = newClient();
      await client.getTotalVisitors('2024-01-01,2024-01-31');
      assert.equal(stub.calls.length, 1);
      assert.deepEqual(stub.calls[0].params, {
        site_id: SITE_ID,
        sitekey: SITE_KEY,
        output: 'json',
        type: 'visitors',
        date: '2024-01-01,2024-01-31',
      });
    });
  });

  describe('getDomainVisitors', () => {
    it('defaults segments to "visitors" when omitted', async () => {
      const { client, stub } = newClient();
      await client.getDomainVisitors('google.com', 'last-7-days');
      assert.equal(stub.calls[0].params.segments, 'visitors');
      assert.equal(stub.calls[0].params.type, 'segmentation');
      assert.equal(stub.calls[0].params.domain, 'google.com');
      assert.equal('limit' in stub.calls[0].params, false);
    });

    it('joins multiple segments with a comma', async () => {
      const { client, stub } = newClient();
      await client.getDomainVisitors('google.com', 'last-7-days', ['pages', 'visitors']);
      assert.equal(stub.calls[0].params.segments, 'pages,visitors');
    });

    it('clamps limit > 1000 down to 1000', async () => {
      const { client, stub } = newClient();
      await client.getDomainVisitors('google.com', 'last-7-days', undefined, 5000);
      assert.equal(stub.calls[0].params.limit, 1000);
    });

    it('passes through limit <= 1000 unchanged', async () => {
      const { client, stub } = newClient();
      await client.getDomainVisitors('google.com', 'last-7-days', undefined, 50);
      assert.equal(stub.calls[0].params.limit, 50);
    });
  });

  describe('getTopPages', () => {
    it('sends type=pages and clamps limit', async () => {
      const { client, stub } = newClient();
      await client.getTopPages('last-7-days', 9999);
      assert.equal(stub.calls[0].params.type, 'pages');
      assert.equal(stub.calls[0].params.limit, 1000);
    });

    it('omits limit param when not provided', async () => {
      const { client, stub } = newClient();
      await client.getTopPages('last-7-days');
      assert.equal('limit' in stub.calls[0].params, false);
    });
  });

  describe('getTrafficSources', () => {
    it('uses type=traffic-sources when no pageUrl is given', async () => {
      const { client, stub } = newClient();
      await client.getTrafficSources('last-7-days');
      assert.equal(stub.calls[0].params.type, 'traffic-sources');
      assert.equal('href' in stub.calls[0].params, false);
    });

    it('uses segmentation + extracted path when given a full URL', async () => {
      const { client, stub } = newClient();
      await client.getTrafficSources('last-7-days', 'https://example.com/blog/post?x=1');
      assert.equal(stub.calls[0].params.type, 'segmentation');
      assert.equal(stub.calls[0].params.href, '/blog/post');
      assert.equal(stub.calls[0].params.segments, 'traffic-sources');
    });

    it('prefixes a leading slash when given a bare path fragment', async () => {
      const { client, stub } = newClient();
      await client.getTrafficSources('last-7-days', 'foo');
      assert.equal(stub.calls[0].params.href, '/foo');
    });

    it('passes through an already-rooted path', async () => {
      const { client, stub } = newClient();
      await client.getTrafficSources('last-7-days', '/about');
      assert.equal(stub.calls[0].params.href, '/about');
    });
  });

  describe('getPageTraffic', () => {
    it('extracts the path and sends type=pages with filter', async () => {
      const { client, stub } = newClient();
      await client.getPageTraffic('https://example.com/blog/post', 'last-7-days');
      assert.equal(stub.calls[0].params.type, 'pages');
      assert.equal(stub.calls[0].params.filter, '/blog/post');
    });
  });

  describe('getVisitorsOnline', () => {
    it('sends type=visitors-online with no date param', async () => {
      const { client, stub } = newClient();
      await client.getVisitorsOnline();
      assert.equal(stub.calls[0].params.type, 'visitors-online');
      assert.equal('date' in stub.calls[0].params, false);
    });
  });

  describe('getBounceRate', () => {
    it('sends the comma-separated bounce-rate,time-average type', async () => {
      const { client, stub } = newClient();
      await client.getBounceRate('last-7-days');
      assert.equal(stub.calls[0].params.type, 'bounce-rate,time-average');
      assert.equal(stub.calls[0].params.date, 'last-7-days');
    });
  });

  describe('list-shaped tools (table-driven)', () => {
    const cases: Array<{
      name: string;
      method: keyof ClickyClient;
      expectedType: string;
    }> = [
      { name: 'actions', method: 'getActions', expectedType: 'actions' },
      { name: 'countries', method: 'getCountries', expectedType: 'countries' },
      { name: 'searches', method: 'getSearches', expectedType: 'searches' },
      {
        name: 'referring domains',
        method: 'getReferringDomains',
        expectedType: 'referrers-domains',
      },
      { name: 'downloads', method: 'getDownloads', expectedType: 'downloads' },
      {
        name: 'outbound links',
        method: 'getOutboundLinks',
        expectedType: 'links-outbound',
      },
    ];

    for (const c of cases) {
      it(`${c.name}: sends type=${c.expectedType} and clamps limit`, async () => {
        const { client, stub } = newClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client[c.method] as any).call(client, 'last-7-days', 5000);
        assert.equal(stub.calls[0].params.type, c.expectedType);
        assert.equal(stub.calls[0].params.limit, 1000);
        assert.equal(stub.calls[0].params.date, 'last-7-days');
      });
    }
  });

  describe('getEntrances', () => {
    it('sends type=pages-entrance and clamps limit', async () => {
      const { client, stub } = newClient();
      await client.getEntrances('last-7-days', 5000);
      assert.equal(stub.calls[0].params.type, 'pages-entrance');
      assert.equal(stub.calls[0].params.limit, 1000);
      assert.equal(stub.calls[0].params.date, 'last-7-days');
      assert.equal('filter' in stub.calls[0].params, false);
    });

    it('omits limit param when not provided', async () => {
      const { client, stub } = newClient();
      await client.getEntrances('last-7-days');
      assert.equal('limit' in stub.calls[0].params, false);
    });

    it('extracts the path when given a full URL', async () => {
      const { client, stub } = newClient();
      await client.getEntrances('last-7-days', undefined, 'https://example.com/blog/post?x=1');
      assert.equal(stub.calls[0].params.filter, '/blog/post');
    });

    it('prefixes a leading slash when given a bare path fragment', async () => {
      const { client, stub } = newClient();
      await client.getEntrances('last-7-days', undefined, 'foo');
      assert.equal(stub.calls[0].params.filter, '/foo');
    });

    it('passes through an already-rooted path', async () => {
      const { client, stub } = newClient();
      await client.getEntrances('last-7-days', undefined, '/about');
      assert.equal(stub.calls[0].params.filter, '/about');
    });
  });
});
