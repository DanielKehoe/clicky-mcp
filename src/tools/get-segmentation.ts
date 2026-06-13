import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ClickyClient, SEGMENTATION_FILTER_KEYS } from '../clicky-client.js';
import { buildDateParam, CLICKY_DATE_KEYWORDS, DateInput } from '../date-utils.js';

export const getSegmentationTool: Tool = {
  name: 'get_segmentation',
  description:
    'Returns data about the sessions matching a filter — for example, all pages those sessions viewed. ' +
    'IMPORTANT: uses session co-occurrence semantics, not click-source attribution. Counts represent ' +
    'all pages viewed within matching sessions and run higher than the number of matching events. ' +
    'Use filter_key "href" with a full outbound URL to get pages viewed by sessions that clicked that link. ' +
    'Use filter_key "goal" with a goal name to filter sessions that completed that goal (e.g. "warp_click_inline_cta"). ' +
    'For the actual page an outbound click fired from, use get_outbound_click_sources instead. ' +
    'Provide EITHER start_date+end_date OR date_range.',
  inputSchema: {
    type: 'object',
    properties: {
      filter_key: {
        type: 'string',
        enum: [...SEGMENTATION_FILTER_KEYS],
        description:
          'Segmentation filter. "href": sessions that visited/clicked a URL; ' +
          '"goal": sessions that completed a goal; "domain": sessions referred by a domain.',
      },
      filter_value: {
        type: 'string',
        description: 'Value to filter by (e.g. full outbound URL for href, goal name for goal).',
      },
      segments: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Data segments to return for matching sessions, e.g. ["pages"], ["visitors"], ' +
          '["summary"], ["visitors","pages"].',
      },
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
        description: 'Maximum number of results per segment (max 1000)',
      },
    },
    required: ['filter_key', 'filter_value', 'segments'],
  },
};

export async function handleGetSegmentation(
  args: DateInput & {
    filter_key: string;
    filter_value: string;
    segments: string[];
    limit?: number;
  },
  clickyClient: ClickyClient
) {
  const date = buildDateParam(args);
  const data = await clickyClient.getSegmentation({
    filterKey: args.filter_key,
    filterValue: args.filter_value,
    segments: args.segments,
    date,
    limit: args.limit,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
