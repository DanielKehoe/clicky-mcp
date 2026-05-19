#!/usr/bin/env node

import { config } from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ClickyClient } from './clicky-client.js';
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

function getCredentials() {
  // Only load .env if credentials aren't already in the environment.
  // Claude Desktop and other MCP hosts pass credentials via the config
  // block, in which case dotenv would be a no-op anyway — and its stdout
  // tip line corrupts the JSON-RPC channel on stdio transports.
  if (!process.env.CLICKY_SITE_ID || !process.env.CLICKY_SITE_KEY) {
    config({ path: '.env', quiet: true });
  }

  const args = process.argv.slice(2);
  let siteId = '';
  let siteKey = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site-id' && args[i + 1]) {
      siteId = args[i + 1];
      i++;
    } else if (args[i] === '--site-key' && args[i + 1]) {
      siteKey = args[i + 1];
      i++;
    }
  }

  if (!siteId) {
    siteId = process.env.CLICKY_SITE_ID || '';
  }
  if (!siteKey) {
    siteKey = process.env.CLICKY_SITE_KEY || '';
  }

  if (!siteId || !siteKey) {
    console.error('Error: Clicky credentials are required');
    console.error('');
    console.error('Provide credentials via:');
    console.error('1. Command line arguments:');
    console.error('   --site-id <your-site-id> --site-key <your-site-key>');
    console.error('');
    console.error('2. Environment variables:');
    console.error('   CLICKY_SITE_ID=<your-site-id>');
    console.error('   CLICKY_SITE_KEY=<your-site-key>');
    console.error('');
    console.error('3. .env file with:');
    console.error('   CLICKY_SITE_ID=<your-site-id>');
    console.error('   CLICKY_SITE_KEY=<your-site-key>');
    process.exit(1);
  }

  return { siteId, siteKey };
}

class ClickyMCPServer {
  private server: Server;
  private clickyClient: ClickyClient;

  constructor(siteId: string, siteKey: string) {
    this.server = new Server(
      {
        name: 'clicky-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.clickyClient = new ClickyClient({
      siteId,
      siteKey,
    });

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_total_visitors':
            return await handleGetTotalVisitors(args as any, this.clickyClient);

          case 'get_domain_visitors':
            return await handleGetDomainVisitors(args as any, this.clickyClient);

          case 'get_top_pages':
            return await handleGetTopPages(args as any, this.clickyClient);

          case 'get_traffic_sources':
            return await handleGetTrafficSources(args as any, this.clickyClient);

          case 'get_page_traffic':
            return await handleGetPageTraffic(args as any, this.clickyClient);

          case 'get_visitors_online':
            return await handleGetVisitorsOnline(args, this.clickyClient);

          case 'get_actions':
            return await handleGetActions(args as any, this.clickyClient);

          case 'get_bounce_rate':
            return await handleGetBounceRate(args as any, this.clickyClient);

          case 'get_countries':
            return await handleGetCountries(args as any, this.clickyClient);

          case 'get_searches':
            return await handleGetSearches(args as any, this.clickyClient);

          case 'get_referring_domains':
            return await handleGetReferringDomains(args as any, this.clickyClient);

          case 'get_downloads':
            return await handleGetDownloads(args as any, this.clickyClient);

          case 'get_entrances':
            return await handleGetEntrances(args as any, this.clickyClient);

          case 'get_outbound_links':
            return await handleGetOutboundLinks(args as any, this.clickyClient);

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
    console.error('Clicky MCP server running on stdio');
  }
}

const { siteId, siteKey } = getCredentials();
const server = new ClickyMCPServer(siteId, siteKey);
server.run().catch(console.error);
