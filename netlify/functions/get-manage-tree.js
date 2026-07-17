// The Manage tab's entity browser: campaigns -> ad sets / ad groups -> ads
// for the selected date range, plus whether this connection can write.
const { getEmailFromRequest, getWorkspaceFromRequest, getDataUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange } = require('./_dates');
const { metaTree, googleTree, BUDGET_CEILING, GUARDRAIL_PCT } = require('./_manage');
const fetch = require('node-fetch');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  const workspace = await getWorkspaceFromRequest(event.headers, email);
  const user = await getDataUser(email, workspace);
  if (!user) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const channel = qs.channel === 'google' ? 'google' : 'meta';
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_7d';
  const { since, until } = custom || resolveRange(range);

  const conn = user.accounts[channel];
  if (!conn || !conn.selectedAdAccountId) {
    return json(200, { state: 'not-connected', channel, range, since, until });
  }
  const accountName =
    ((conn.adAccounts || []).find((a) => a.id === conn.selectedAdAccountId) || {}).name || conn.selectedAdAccountId;

  // Write capability. Google's adwords scope always allows writes (account
  // role permitting - surfaced per write); Meta needs ads_management, which
  // is checked at connect time. Connections that predate the check are
  // probed once here and the result stored.
  let canManage = conn.canManage;
  if (channel === 'google') canManage = true;
  if (channel === 'meta' && canManage === undefined) {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${conn.accessToken}`);
      const data = await res.json();
      canManage = (data.data || []).some((p) => p.permission === 'ads_management' && p.status === 'granted');
      conn.canManage = canManage;
      await saveUser(user).catch(() => {});
    } catch {
      canManage = false;
    }
  }

  try {
    const tree = channel === 'meta' ? await metaTree(conn, since, until) : await googleTree(conn, since, until);
    return json(200, {
      state: 'ok',
      channel,
      range,
      since,
      until,
      accountId: conn.selectedAdAccountId,
      accountName,
      canManage: !!canManage,
      guardrails: { pct: GUARDRAIL_PCT, ceiling: BUDGET_CEILING },
      ...tree
    });
  } catch (err) {
    console.error(`[get-manage-tree] ${channel} failed: ${err.message}`);
    const expired = /session has expired|invalid.*token|OAuth|UNAUTHENTICATED|401/i.test(err.message || '');
    return json(200, { state: expired ? 'needs-reconnect' : 'unavailable', channel, error: err.message });
  }
};
