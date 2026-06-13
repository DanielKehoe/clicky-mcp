import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ClickyClient } from '../clicky-client.js';
import { buildDateParam, CLICKY_DATE_KEYWORDS, DateInput } from '../date-utils.js';

// The un-filtered action log is paged sequentially (Clicky allows only one
// concurrent request per site), so each page adds round-trip latency. Long
// windows (e.g. a full month at 1–2k actions/day = 30–60 pages) can exceed the
// MCP client timeout. We cap the walk and report `truncated` honestly; for long
// windows or links that have a Clicky goal, pass `goal` to use the fast,
// single-request goal-segmentation path instead.
const ACTIONS_PAGE_CAP = 20;

interface ActionItem {
  session_id: string;
  time: string | number;
  action_type: string;
  action_url?: string;
}

// Reduce absolute and relative forms of the same page to a single pathname so
// they merge instead of double-counting (Clicky records both
// "https://site/macos/upgrade" and "/macos/upgrade" as distinct rows).
function normalizePath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    const p = u.split(/[?#]/)[0];
    return p.startsWith('/') ? p : '/' + p;
  }
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

interface PageItem {
  page: string;
  value: number;
}

// Parse the `segments=pages` response shape ([{ type, dates:[{ items:[...] }] }]).
// Each item carries `url` (absolute) and/or `title` (sometimes a relative path),
// plus a string `value` count.
function extractPageItems(data: unknown): PageItem[] {
  if (!Array.isArray(data) || !data.length) return [];
  const first = data[0];
  if (!first || typeof first !== 'object') return [];
  const dates = (first as Record<string, unknown>).dates;
  if (!Array.isArray(dates)) return [];
  return dates
    .flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const items = (entry as Record<string, unknown>).items;
      return Array.isArray(items) ? items : [];
    })
    .map((it) => {
      const rec = it as Record<string, unknown>;
      const page = typeof rec.url === 'string' ? rec.url : typeof rec.title === 'string' ? rec.title : '';
      const value = parseInt(String(rec.value ?? '0'), 10) || 0;
      return { page, value };
    })
    .filter((x) => x.page);
}

export const getOutboundClickSourcesTool: Tool = {
  name: 'get_outbound_click_sources',
  description:
    'Identifies which pages on your site clicks on a specific outbound link come from. ' +
    '"strict" method (default): the actual source page each click fired from. ' +
    'If the link has a Clicky goal that records the completion page, pass `goal` — strict then uses a ' +
    'single fast goal-segmentation request (recommended, and required for windows longer than ~2 weeks). ' +
    'Without `goal`, strict reconstructs the source page by walking the un-filtered action log sequentially ' +
    '(accurate for short windows; capped, with a `truncated` flag when the cap is hit). ' +
    '"session" method: pages co-viewed in the same session as the click — one request, faster, ' +
    'but counts run ~2× higher because they include every page the session visited, not just the click source. ' +
    'Page URLs are normalized to pathnames so absolute and relative forms merge. ' +
    'Provide EITHER start_date+end_date OR date_range.',
  inputSchema: {
    type: 'object',
    properties: {
      outbound_url: {
        type: 'string',
        description: 'Full outbound URL to attribute (e.g. "https://warp.dev/mac-terminal").',
      },
      goal: {
        type: 'string',
        description:
          'Optional. Clicky goal name whose completion page IS the click source (e.g. "warp_click_inline_cta"). ' +
          'When provided with method="strict", uses one fast goal-segmentation request instead of the action-log walk — ' +
          'robust and timeout-free, so use it for monthly windows. Ignored for method="session".',
      },
      method: {
        type: 'string',
        enum: ['strict', 'session'],
        description:
          '"strict" (default): the actual page each click fired from (via `goal` fast path, or action-log walk). ' +
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
    goal?: string;
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

  // strict
  const result = args.goal
    ? await goalAttribution(clickyClient, args.goal, date, limit)
    : await strictReconstruct(clickyClient, args.outbound_url, date, limit);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// Fast path: the goal's completion pages ARE the click source pages. One request,
// no sequential paging, no timeout. Normalizes + merges absolute/relative forms.
async function goalAttribution(client: ClickyClient, goal: string, date: string, limit: number) {
  const data = await client.getSegmentation({
    filterKey: 'goal',
    filterValue: goal,
    segments: ['pages'],
    date,
    limit: 1000,
  });

  const pageCounts = new Map<string, number>();
  for (const { page, value } of extractPageItems(data)) {
    const norm = normalizePath(page);
    pageCounts.set(norm, (pageCounts.get(norm) ?? 0) + value);
  }

  const items = Array.from(pageCounts.entries())
    .map(([page, clicks]) => ({ page, clicks }))
    .sort((a, b) => b.clicks - a.clicks);
  const totalClicks = items.reduce((sum, i) => sum + i.clicks, 0);

  return {
    method: 'strict',
    attribution_source: 'goal',
    goal,
    items: items.slice(0, limit),
    total_clicks: totalClicks,
    unattributed: 0,
  };
}

async function strictReconstruct(
  client: ClickyClient,
  outboundUrl: string,
  date: string,
  limit: number
) {
  // Step 1: Collect all outbound click events for this URL (paged). The `href`
  // filter returns only `outbound` rows; we keep (session_id, time) per click.
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
    return {
      method: 'strict',
      attribution_source: 'action-log',
      items: [],
      total_clicks: 0,
      unattributed: 0,
      pages_fetched: 0,
    };
  }

  // Step 2: Fetch the un-filtered action log paged sequentially — Clicky enforces
  // one request per site per IP at a time, so these must NOT be parallelised. No
  // `href` filter here (a leaked filter would return only outbound rows, leaving
  // zero pageviews to match against → everything unattributed).
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

  // actions-list is newest-first; sort each session ascending so "latest pageview
  // at or before the click" is found by max-over-time, not array position. `time`
  // is a string epoch — compare numerically.
  for (const actions of sessionActions.values()) {
    actions.sort((a, b) => Number(a.time) - Number(b.time));
  }

  // Step 3: For each click, the source page is the pageview in the same session
  // with the greatest time <= click.time. `click` and `outbound` rows are not
  // pageviews and are skipped. Page URLs are normalized so forms merge.
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
      if (action.action_type === 'pageview' && action.action_url) {
        sourcePage = normalizePath(action.action_url);
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
    attribution_source: 'action-log',
    items,
    total_clicks: totalClicks,
    unattributed,
    pages_fetched: pagesFetched,
  };

  if (truncated) {
    result.truncated = true;
    result.truncation_warning =
      `Action log hit the ${ACTIONS_PAGE_CAP}-page cap (${ACTIONS_PAGE_CAP * 1000} actions); ` +
      'some clicks may be unattributed. For a long window, narrow the dates or pass `goal` to use the fast goal-segmentation path.';
  }

  return result;
}
