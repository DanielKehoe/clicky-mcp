import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ClickyClient } from '../clicky-client.js';
import { buildDateParam, CLICKY_DATE_KEYWORDS, DateInput } from '../date-utils.js';

const ACTIONS_PAGE_CAP = 35;

interface ActionItem {
  session_id: string;
  time: string | number;
  action_type: string;
  url?: string;
}

function extractActionItems(data: unknown): ActionItem[] {
  if (!Array.isArray(data) || !data.length) return [];
  const first = data[0];
  if (!first || typeof first !== 'object') return [];
  const dates = (first as Record<string, unknown>).dates;
  if (!Array.isArray(dates)) return [];
  return dates.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const items = (entry as Record<string, unknown>).items;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item): item is ActionItem =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).session_id === 'string'
    );
  });
}

export const getOutboundClickSourcesTool: Tool = {
  name: 'get_outbound_click_sources',
  description:
    'Identifies which pages on your site clicks on a specific outbound link come from. ' +
    '"strict" method (default): reconstructs the actual source page by matching each outbound click to ' +
    'the preceding pageview in the same session — accurate but requires fetching the full action log sequentially. ' +
    '"session" method: returns pages co-viewed in the same session as the click — one request, faster, ' +
    'but counts run ~2× higher than strict because they include all pages the session visited, not just the click source. ' +
    'Provide EITHER start_date+end_date OR date_range.',
  inputSchema: {
    type: 'object',
    properties: {
      outbound_url: {
        type: 'string',
        description: 'Full outbound URL to attribute (e.g. "https://warp.dev/mac-terminal").',
      },
      method: {
        type: 'string',
        enum: ['strict', 'session'],
        description:
          '"strict" (default): find the actual page each click fired from (accurate, multiple sequential requests). ' +
          '"session": pages co-viewed by sessions that clicked the link (fast, 1 request, inflated counts).',
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
        description: 'Maximum number of source pages to return, sorted by clicks desc (default 50).',
      },
    },
    required: ['outbound_url'],
  },
};

export async function handleGetOutboundClickSources(
  args: DateInput & {
    outbound_url: string;
    method?: 'strict' | 'session';
    limit?: number;
  },
  clickyClient: ClickyClient
) {
  const date = buildDateParam(args);
  const method = args.method ?? 'strict';
  const limit = args.limit ?? 50;

  if (method === 'session') {
    const data = await clickyClient.getSegmentation({
      filterKey: 'href',
      filterValue: args.outbound_url,
      segments: ['pages'],
      date,
      limit,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              method: 'session',
              note: 'Session co-occurrence: counts all pages viewed by sessions that clicked the link. Values run higher than actual click-source counts.',
              data,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const result = await strictReconstruct(clickyClient, args.outbound_url, date, limit);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function strictReconstruct(
  client: ClickyClient,
  outboundUrl: string,
  date: string,
  limit: number
) {
  // Step 1: Collect all outbound click events for this URL (paged)
  const clickEvents: ActionItem[] = [];
  for (let page = 1; ; page++) {
    const data = await client.getActionsList({
      filterKey: 'href',
      filterValue: outboundUrl,
      date,
      limit: 1000,
      page,
    });
    const items = extractActionItems(data);
    clickEvents.push(...items);
    if (items.length < 1000) break;
  }

  if (clickEvents.length === 0) {
    return { method: 'strict', items: [], total_clicks: 0, unattributed: 0, pages_fetched: 0 };
  }

  // Step 2: Fetch full action log paged sequentially — Clicky enforces one request
  // per site per IP at a time, so these must not be parallelised.
  const sessionActions = new Map<string, ActionItem[]>();
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 1; page <= ACTIONS_PAGE_CAP; page++) {
    const data = await client.getActionsList({ date, limit: 1000, page });
    const items = extractActionItems(data);
    pagesFetched = page;

    for (const item of items) {
      if (!sessionActions.has(item.session_id)) {
        sessionActions.set(item.session_id, []);
      }
      sessionActions.get(item.session_id)!.push(item);
    }

    if (items.length < 1000) break;
    if (page === ACTIONS_PAGE_CAP) truncated = true;
  }

  // Sort each session's actions chronologically
  for (const actions of sessionActions.values()) {
    actions.sort((a, b) => Number(a.time) - Number(b.time));
  }

  // Step 3: For each outbound click, walk back to the nearest preceding pageview
  const pageCounts = new Map<string, number>();
  let totalClicks = 0;
  let unattributed = 0;

  for (const click of clickEvents) {
    totalClicks++;
    const clickTime = Number(click.time);
    const actions = sessionActions.get(click.session_id) ?? [];

    let sourcePage: string | null = null;
    for (const action of actions) {
      if (Number(action.time) > clickTime) break;
      if (action.action_type === 'pageview' && action.url) {
        sourcePage = action.url;
      }
    }

    if (sourcePage !== null) {
      pageCounts.set(sourcePage, (pageCounts.get(sourcePage) ?? 0) + 1);
    } else {
      unattributed++;
    }
  }

  const items = Array.from(pageCounts.entries())
    .map(([page, clicks]) => ({ page, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);

  const result: Record<string, unknown> = {
    method: 'strict',
    items,
    total_clicks: totalClicks,
    unattributed,
    pages_fetched: pagesFetched,
  };

  if (truncated) {
    result.truncation_warning = `Action log exceeded ${ACTIONS_PAGE_CAP} pages (${ACTIONS_PAGE_CAP * 1000} actions); some source pages may be undetected.`;
  }

  return result;
}
