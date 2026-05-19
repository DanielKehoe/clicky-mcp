import axios, { AxiosInstance } from 'axios';

export interface ClickyConfig {
  siteId: string;
  siteKey: string;
  baseUrl?: string;
  httpClient?: AxiosInstance;
}

export class ClickyClient {
  private client: AxiosInstance;
  private siteId: string;
  private siteKey: string;

  constructor(config: ClickyConfig) {
    this.siteId = config.siteId;
    this.siteKey = config.siteKey;

    this.client =
      config.httpClient ??
      axios.create({
        baseURL: config.baseUrl || 'https://api.clicky.com/api/stats/4',
        timeout: 30000,
      });
  }

  private baseParams() {
    return {
      site_id: this.siteId,
      sitekey: this.siteKey,
      output: 'json',
    };
  }

  private extractPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url.startsWith('/') ? url : '/' + url;
    }
  }

  private clampLimit(limit?: number): number | undefined {
    return limit ? Math.min(limit, 1000) : undefined;
  }

  async getTotalVisitors(date: string): Promise<unknown> {
    const response = await this.client.get('', {
      params: { ...this.baseParams(), type: 'visitors', date },
    });
    return response.data;
  }

  async getDomainVisitors(
    domain: string,
    date: string,
    segments?: string[],
    limit?: number
  ): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'segmentation',
      domain,
      segments: segments ? segments.join(',') : 'visitors',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getTopPages(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'pages',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getTrafficSources(date: string, pageUrl?: string): Promise<unknown> {
    const params: Record<string, unknown> = { ...this.baseParams(), date };
    if (pageUrl) {
      params.type = 'segmentation';
      params.href = this.extractPath(pageUrl);
      params.segments = 'traffic-sources';
    } else {
      params.type = 'traffic-sources';
    }
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getPageTraffic(url: string, date: string): Promise<unknown> {
    const response = await this.client.get('', {
      params: {
        ...this.baseParams(),
        type: 'pages',
        filter: this.extractPath(url),
        date,
      },
    });
    return response.data;
  }

  async getVisitorsOnline(): Promise<unknown> {
    const response = await this.client.get('', {
      params: { ...this.baseParams(), type: 'visitors-online' },
    });
    return response.data;
  }

  async getActions(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'actions',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getBounceRate(date: string): Promise<unknown> {
    const response = await this.client.get('', {
      params: {
        ...this.baseParams(),
        type: 'bounce-rate,time-average',
        date,
      },
    });
    return response.data;
  }

  async getCountries(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'countries',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getSearches(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'searches',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getReferringDomains(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'referrers-domains',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getDownloads(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'downloads',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getEntrances(date: string, limit?: number, url?: string): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'pages-entrance',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    if (url) params.filter = this.extractPath(url);
    const response = await this.client.get('', { params });
    return response.data;
  }

  async getOutboundLinks(date: string, limit?: number): Promise<unknown> {
    const params: Record<string, unknown> = {
      ...this.baseParams(),
      type: 'links-outbound',
      date,
    };
    const lim = this.clampLimit(limit);
    if (lim) params.limit = lim;
    const response = await this.client.get('', { params });
    return response.data;
  }
}
