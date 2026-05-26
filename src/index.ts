#!/usr/bin/env node

import { config } from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { SiteRegistry } from './site-registry.js';
import { getTotalVisitorsTool, handleGetTotalVisitors } from './tools/get-total-visitors.js';
import { getDomainVisitorsTool, handleGetDomainVisitors } from './tools/get-domain-visitors.js';
import { getTopPagesTool, handleGetTopPages } from './tools/get-top-pages.js';
import { getTrafficSourcesTool, handleGetTrafficSources } from './tools/get-traffic-sources.js';
import { getPageTrafficTool, handleGetPageTraffic } from './tools/get-page-traffic.js';
import { getVisitorsOnlineTool, handleGetVisitorsOnline } from './tools/get-visitors-online.js';
import { getActionsTool, handleGetActions } from './tools/get-actions.js';
import { getBounceRateTool, handleGetBounceRate } from './tools/get-bounce-rate.js';
import { getCountriesTool, handleGetCountries } from './tools/get-countries.js';
import { getSearchesTool, handleGetSearches } from './tools/get-searches.js';
import { getReferringDomainsTool, handleGetReferringDomains } from './tools/get-referring-domains.js';
import { getDownloadsTool, handleGetDownloads } from './tools/get-downloads.js';
import { getEntrancesTool, handleGetEntrances } from './tools/get-entrances.js';
import { getOutboundLinksTool, handleGetOutboundLinks } from './tools/get-outbound-links.js';

function loadRegistry(): SiteRegistry {
  // Only load .env if neither env style is already populated. Claude Desktop
  // and other MCP hosts pass credentials via the config block, in which case
  // dotenv would be a no-op anyway — and its stdout tip line corrupts the
  // JSON-RPC channel on stdio transports.
  if (!process.env.CLICKY_SITES && !process.env.CLICKY_SITE_ID) {
    config({ path: '.env', quiet: true });
  }

  try {
    return new SiteRegistry({
      sitesJson: process.env.CLICKY_SITES,
      legacySiteId: process.env.CLICKY_SITE_ID,
      legacySiteKey: process.env.CLICKY_SITE_KEY,
      defaultSite: process.env.CLICKY_DEFAULT_SITE,
    });
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error('');
    console.error('Provide credentials via:');
    console.error('1. CLICKY_SITES (multi-site, recommended):');
    console.error('   CLICKY_SITES=\'{"install.guide":{"site_id":"...","site_key":"..."},');
    console.error('                   "astrologyprompt.com":{"site_id":"...","site_key":"..."}}\'');
    console.error('   CLICKY_DEFAULT_SITE=install.guide   # optional');
    console.error('');
    console.error('2. Legacy single-site env vars (registered under alias "default"):');
    console.error('   CLICKY_SITE_ID=<id>');
    console.error('   CLICKY_SITE_KEY=<key>');
    process.exit(1);
  }
}

const BASE_TOOLS: Tool[] = [
  getTotalVisitorsTool,
  getDomainVisitorsTool,
  getTopPagesTool,
  getTrafficSourcesTool,
  getPageTrafficTool,
  getVisitorsOnlineTool,
  getActionsTool,
  getBounceRateTool,
  getCountriesTool,
  getSearchesTool,
  getReferringDomainsTool,
  getDownloadsTool,
  getEntrancesTool,
  getOutboundLinksTool,
];

function withSiteParam(tool: Tool, aliases: string[], defaultAlias: string): Tool {
  const schema = tool.inputSchema ?? { type: 'object', properties: {} };
  const properties: Record<string, object> = { ...(schema.properties ?? {}) };
  properties.site = {
    type: 'string',
    enum: aliases,
    description: `Site alias to query. Defaults to "${defaultAlias}" when omitted. Use list_sites to see all configured sites.`,
  };
  return {
    ...tool,
    inputSchema: { ...schema, type: 'object', properties },
  };
}

function listSitesTool(): Tool {
  return {
    name: 'list_sites',
    description:
      'List all Clicky sites configured for this MCP server. Returns each site alias, its Clicky site_id, and which one is the default.',
    inputSchema: { type: 'object', properties: {} },
  };
}

class ClickyMCPServer {
  private server: Server;
  private registry: SiteRegistry;

  constructor(registry: SiteRegistry) {
    this.registry = registry;
    this.server = new Server(
      { name: 'clicky-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private setupHandlers() {
    const aliases = this.registry.listAliases();
    const defaultAlias = this.registry.getDefaultAlias();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        listSitesTool(),
        ...BASE_TOOLS.map((t) => withSiteParam(t, aliases, defaultAlias)),
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      try {
        if (name === 'list_sites') {
          return {
            content: [
              { type: 'text', text: JSON.stringify(this.registry.describe(), null, 2) },
            ],
          };
        }

        const siteArg = typeof args.site === 'string' ? args.site : undefined;
        const client = this.registry.getClient(siteArg);
        // Strip the routing-only `site` param before dispatching to handlers
        // that don't know about it.
        const { site: _site, ...handlerArgs } = args;
        void _site;

        switch (name) {
          case 'get_total_visitors':
            return await handleGetTotalVisitors(handlerArgs as any, client);
          case 'get_domain_visitors':
            return await handleGetDomainVisitors(handlerArgs as any, client);
          case 'get_top_pages':
            return await handleGetTopPages(handlerArgs as any, client);
          case 'get_traffic_sources':
            return await handleGetTrafficSources(handlerArgs as any, client);
          case 'get_page_traffic':
            return await handleGetPageTraffic(handlerArgs as any, client);
          case 'get_visitors_online':
            return await handleGetVisitorsOnline(handlerArgs as any, client);
          case 'get_actions':
            return await handleGetActions(handlerArgs as any, client);
          case 'get_bounce_rate':
            return await handleGetBounceRate(handlerArgs as any, client);
          case 'get_countries':
            return await handleGetCountries(handlerArgs as any, client);
          case 'get_searches':
            return await handleGetSearches(handlerArgs as any, client);
          case 'get_referring_domains':
            return await handleGetReferringDomains(handlerArgs as any, client);
          case 'get_downloads':
            return await handleGetDownloads(handlerArgs as any, client);
          case 'get_entrances':
            return await handleGetEntrances(handlerArgs as any, client);
          case 'get_outbound_links':
            return await handleGetOutboundLinks(handlerArgs as any, client);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(
      `Clicky MCP server running on stdio (sites: ${this.registry.listAliases().join(', ')}; default: ${this.registry.getDefaultAlias()})`
    );
  }
}

const registry = loadRegistry();
const server = new ClickyMCPServer(registry);
server.run().catch(console.error);
