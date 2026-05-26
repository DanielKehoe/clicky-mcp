import { ClickyClient } from './clicky-client.js';

export interface SiteCredentials {
  site_id: string;
  site_key: string;
}

export interface SiteRegistryOptions {
  sitesJson?: string;
  legacySiteId?: string;
  legacySiteKey?: string;
  defaultSite?: string;
}

export class SiteRegistry {
  private clients = new Map<string, ClickyClient>();
  private credentials = new Map<string, SiteCredentials>();
  private defaultAlias: string;

  constructor(opts: SiteRegistryOptions) {
    const fromJson = parseSitesJson(opts.sitesJson);
    const fromLegacy = parseLegacy(opts.legacySiteId, opts.legacySiteKey);

    for (const [alias, creds] of Object.entries(fromJson)) {
      this.register(alias, creds);
    }
    for (const [alias, creds] of Object.entries(fromLegacy)) {
      if (!this.credentials.has(alias)) {
        this.register(alias, creds);
      }
    }

    if (this.credentials.size === 0) {
      throw new Error(
        'No Clicky sites configured. Set CLICKY_SITES (JSON map of alias to {site_id, site_key}) or the legacy CLICKY_SITE_ID/CLICKY_SITE_KEY pair.'
      );
    }

    this.defaultAlias = resolveDefaultAlias(
      opts.defaultSite,
      Array.from(this.credentials.keys())
    );
  }

  private register(alias: string, creds: SiteCredentials) {
    this.credentials.set(alias, creds);
    this.clients.set(
      alias,
      new ClickyClient({ siteId: creds.site_id, siteKey: creds.site_key })
    );
  }

  getClient(alias?: string): ClickyClient {
    const key = alias ?? this.defaultAlias;
    const client = this.clients.get(key);
    if (!client) {
      throw new Error(
        `Unknown Clicky site "${key}". Available: ${this.listAliases().join(', ')}`
      );
    }
    return client;
  }

  listAliases(): string[] {
    return Array.from(this.credentials.keys());
  }

  /** Return alias -> site_id (no keys), for the list_sites tool. */
  describe(): Array<{ alias: string; site_id: string; is_default: boolean }> {
    return this.listAliases().map((alias) => ({
      alias,
      site_id: this.credentials.get(alias)!.site_id,
      is_default: alias === this.defaultAlias,
    }));
  }

  getDefaultAlias(): string {
    return this.defaultAlias;
  }
}

function parseSitesJson(raw?: string): Record<string, SiteCredentials> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `CLICKY_SITES is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CLICKY_SITES must be a JSON object keyed by site alias.');
  }
  const out: Record<string, SiteCredentials> = {};
  for (const [alias, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`CLICKY_SITES["${alias}"] must be an object with site_id and site_key.`);
    }
    const v = value as Record<string, unknown>;
    const siteId = typeof v.site_id === 'string' ? v.site_id : '';
    const siteKey = typeof v.site_key === 'string' ? v.site_key : '';
    if (!siteId || !siteKey) {
      throw new Error(
        `CLICKY_SITES["${alias}"] is missing site_id or site_key (both must be non-empty strings).`
      );
    }
    out[alias] = { site_id: siteId, site_key: siteKey };
  }
  return out;
}

function parseLegacy(
  siteId?: string,
  siteKey?: string
): Record<string, SiteCredentials> {
  if (!siteId || !siteKey) return {};
  return { default: { site_id: siteId, site_key: siteKey } };
}

function resolveDefaultAlias(explicit: string | undefined, aliases: string[]): string {
  if (explicit) {
    if (!aliases.includes(explicit)) {
      throw new Error(
        `CLICKY_DEFAULT_SITE="${explicit}" does not match any configured site. Available: ${aliases.join(', ')}`
      );
    }
    return explicit;
  }
  if (aliases.includes('default')) return 'default';
  return aliases[0];
}
