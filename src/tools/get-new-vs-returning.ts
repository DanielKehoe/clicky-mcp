import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ClickyClient } from '../clicky-client.js';
import { buildDateParam, CLICKY_DATE_KEYWORDS, DateInput } from '../date-utils.js';

export const getNewVsReturningTool: Tool = {
  name: 'get_new_vs_returning',
  description:
    'Get new vs returning visitors for a date range. Returns Clicky visits ("visitors" — Clicky counts each session as a visitor), unique visitors, and new (first-time) visitors, plus returning_visits = visits - new and the shares. Returning is detected by cookie, so browsers that expire cookies (Safari caps them at 7 days) make it a lower bound. Provide EITHER start_date+end_date OR date_range.',
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
    },
  },
};

interface VisitorType {
  type?: string;
  dates?: Array<{ date?: string; items?: Array<{ value?: string }> }>;
}

function looksLikeVisitorTypes(data: unknown): data is VisitorType[] {
  return (
    Array.isArray(data) &&
    data.every(
      (d) => d && typeof d === 'object' && Array.isArray((d as VisitorType).dates)
    )
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function handleGetNewVsReturning(args: DateInput, clickyClient: ClickyClient) {
  const date = buildDateParam(args);
  const data = await clickyClient.getNewVsReturning(date);

  if (!looksLikeVisitorTypes(data)) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  const valueOf = (type: string): number | undefined => {
    const raw = data.find((d) => d.type === type)?.dates?.[0]?.items?.[0]?.value;
    return raw === undefined ? undefined : parseInt(raw);
  };
  const visits = valueOf('visitors');
  const unique = valueOf('visitors-unique');
  const fresh = valueOf('visitors-new');

  if (visits === undefined || fresh === undefined) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  const returningVisits = visits - fresh;
  const summary = {
    date: data[0].dates?.[0]?.date,
    visits,
    unique_visitors: unique ?? null,
    new_visitors: fresh,
    returning_visits: returningVisits,
    returning_visit_share_pct: visits ? round1((returningVisits / visits) * 100) : null,
    new_share_of_unique_pct: unique ? round1((fresh / unique) * 100) : null,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
  };
}
