// Demo-mode request adapter - the single choke point behind api.request().
// On /demo routes every read resolves locally from the fixture derivations
// and every write is blocked with the demo toast; nothing touches cookies,
// JWTs or the database. The one exception is pulse-chat, which goes to the
// network flagged demo:true so the live AI can answer over the sample data
// (the server supplies its own fixture context and ignores the client's).
import { DEMO_MESSAGE, DEMO_BLOCKED_EVENT } from './constants';
import {
  buildReport,
  buildManageTree,
  buildHeatmap,
  buildStatus,
  buildWorkspaces,
  buildMetricsConfig,
  buildAutomations,
  buildStudioConfig,
  buildStudioGallery,
  buildAccounts,
  buildChips,
  chatFallback
} from './derive';

class DemoBlockedError extends Error {
  constructor() {
    super(DEMO_MESSAGE);
    this.status = 403;
  }
}

const blocked = () => {
  window.dispatchEvent(new Event(DEMO_BLOCKED_EVENT));
  throw new DemoBlockedError();
};

export async function demoRequest(path, options = {}, passthrough) {
  const url = new URL(path, window.location.origin);
  const fn = url.pathname.split('/').pop();
  const q = Object.fromEntries(url.searchParams);
  const method = (options.method || 'GET').toUpperCase();

  if (fn === 'pulse-chat') {
    let payload = {};
    try {
      payload = JSON.parse(options.body || '{}');
    } catch {
      // malformed body - fall through with empty payload
    }
    try {
      const r = await passthrough(path, {
        ...options,
        body: JSON.stringify({ message: payload.message, chip: payload.chip, demo: true })
      });
      // action buttons navigate into the real app, which a demo visitor
      // doesn't have - never surface them
      return { reply: r.reply, actions: [], alert: null };
    } catch {
      return { reply: chatFallback(payload.chip), actions: [], alert: null };
    }
  }

  if (method !== 'GET') return blocked();

  switch (fn) {
    case 'get-status':
      return buildStatus();
    case 'workspaces-list':
      return buildWorkspaces();
    case 'get-report':
      return buildReport(q);
    case 'get-manage-tree':
      return buildManageTree(q, q.channel === 'google' ? 'google' : 'meta');
    case 'get-heatmap':
      return buildHeatmap(q);
    case 'metrics-config':
      return buildMetricsConfig();
    case 'automation-settings':
      return buildAutomations();
    case 'studio-config':
      return buildStudioConfig();
    case 'studio-gallery':
      return buildStudioGallery();
    case 'list-accounts':
      return buildAccounts();
    case 'pulse-chips':
      return buildChips();
    case 'list-alerts':
      return { alerts: [] };
    case 'change-request':
      return { requests: [] };
    default:
      return blocked();
  }
}
