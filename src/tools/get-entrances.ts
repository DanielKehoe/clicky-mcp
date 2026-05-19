import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ClickyClient } from '../clicky-client.js';
import { buildDateParam, CLICKY_DATE_KEYWORDS, DateInput } from '../date-utils.js';

export const getEntrancesTool: Tool = {
  name: 'get_entrances',
  description:
    'Get top landing pages (entrances) for a date range — first page of a visitor session, distinct from total views. Optionally filter to a specific page URL. Provide EITHER start_date+end_date OR date_range.',
  inputSchema: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Start date in YYYY-MM-DD format',
      },
      end_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'End date in YYYY-MM-DD format',
      },
      date_range: {
        type: 'string',
        enum: [...CLICKY_DATE_KEYWORDS],
        description: 'Clicky relative date keyword (alternative to start_date+end_date)',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 1000,
        description: 'Maximum number of landing pages to return (max 1000)',
      },
      url: {
        type: 'string',
        description:
          'Optional: full URL or path to filter to a specific landing page (e.g. https://example.com/path or /path)',
      },
    },
  },
};

export async function handleGetEntrances(
  args: DateInput & { limit?: number; url?: string },
  clickyClient: ClickyClient
) {
  const date = buildDateParam(args);
  const data = await clickyClient.getEntrances(date, args.limit, args.url);
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
