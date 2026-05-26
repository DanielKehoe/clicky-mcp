import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SiteRegistry } from '../src/site-registry.js';

describe('SiteRegistry', () => {
  it('loads multiple sites from CLICKY_SITES JSON', () => {
    const sitesJson = JSON.stringify({
      'install.guide': { site_id: '101430979', site_key: 'k1' },
      'astrologyprompt.com': { site_id: '101505474', site_key: 'k2' },
    });
    const reg = new SiteRegistry({ sitesJson });
    assert.deepEqual(reg.listAliases().sort(), [
      'astrologyprompt.com',
      'install.guide',
    ]);
  });

  it('routes getClient(alias) to distinct clients per site', () => {
    const sitesJson = JSON.stringify({
      a: { site_id: '1', site_key: 'k1' },
      b: { site_id: '2', site_key: 'k2' },
    });
    const reg = new SiteRegistry({ sitesJson });
    assert.notEqual(reg.getClient('a'), reg.getClient('b'));
  });

  it('falls back to legacy single-site env vars under alias "default"', () => {
    const reg = new SiteRegistry({
      legacySiteId: '101430979',
      legacySiteKey: 'k',
    });
    assert.deepEqual(reg.listAliases(), ['default']);
    assert.equal(reg.getDefaultAlias(), 'default');
  });

  it('prefers explicit CLICKY_DEFAULT_SITE when provided', () => {
    const sitesJson = JSON.stringify({
      'install.guide': { site_id: '1', site_key: 'k1' },
      'astrologyprompt.com': { site_id: '2', site_key: 'k2' },
    });
    const reg = new SiteRegistry({ sitesJson, defaultSite: 'astrologyprompt.com' });
    assert.equal(reg.getDefaultAlias(), 'astrologyprompt.com');
  });

  it('uses "default" alias as the default when present and no explicit default is set', () => {
    const sitesJson = JSON.stringify({
      other: { site_id: '1', site_key: 'k1' },
      default: { site_id: '2', site_key: 'k2' },
    });
    const reg = new SiteRegistry({ sitesJson });
    assert.equal(reg.getDefaultAlias(), 'default');
  });

  it('falls back to the first alias when neither default name nor explicit is set', () => {
    const sitesJson = JSON.stringify({
      'install.guide': { site_id: '1', site_key: 'k1' },
      'astrologyprompt.com': { site_id: '2', site_key: 'k2' },
    });
    const reg = new SiteRegistry({ sitesJson });
    assert.equal(reg.getDefaultAlias(), 'install.guide');
  });

  it('throws a clear error for an unknown site alias', () => {
    const reg = new SiteRegistry({ legacySiteId: '1', legacySiteKey: 'k' });
    assert.throws(() => reg.getClient('astrologyprompt.com'), /Unknown Clicky site/);
  });

  it('throws when CLICKY_DEFAULT_SITE references a missing alias', () => {
    const sitesJson = JSON.stringify({ a: { site_id: '1', site_key: 'k' } });
    assert.throws(
      () => new SiteRegistry({ sitesJson, defaultSite: 'b' }),
      /does not match any configured site/
    );
  });

  it('throws on malformed CLICKY_SITES JSON', () => {
    assert.throws(
      () => new SiteRegistry({ sitesJson: '{not json' }),
      /not valid JSON/
    );
  });

  it('throws when a site entry is missing site_id or site_key', () => {
    const sitesJson = JSON.stringify({ a: { site_id: '1' } });
    assert.throws(
      () => new SiteRegistry({ sitesJson }),
      /missing site_id or site_key/
    );
  });

  it('throws when no sites are configured at all', () => {
    assert.throws(() => new SiteRegistry({}), /No Clicky sites configured/);
  });

  it('describe() returns alias and site_id but not site_key, and marks the default', () => {
    const sitesJson = JSON.stringify({
      a: { site_id: '1', site_key: 'secret-1' },
      b: { site_id: '2', site_key: 'secret-2' },
    });
    const reg = new SiteRegistry({ sitesJson, defaultSite: 'b' });
    const described = reg.describe();
    assert.deepEqual(described, [
      { alias: 'a', site_id: '1', is_default: false },
      { alias: 'b', site_id: '2', is_default: true },
    ]);
    // No site_key field on any entry
    for (const d of described) {
      assert.equal('site_key' in d, false);
    }
  });

  it('CLICKY_SITES takes precedence over legacy env vars on alias collision', () => {
    const sitesJson = JSON.stringify({
      default: { site_id: 'new-id', site_key: 'new-key' },
    });
    const reg = new SiteRegistry({
      sitesJson,
      legacySiteId: 'old-id',
      legacySiteKey: 'old-key',
    });
    assert.deepEqual(reg.describe(), [
      { alias: 'default', site_id: 'new-id', is_default: true },
    ]);
  });
});
