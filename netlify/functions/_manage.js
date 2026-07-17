// Phase-1 ad management: the entity tree (read) and the three write
// operations (status, budget, bid) for Meta and Google. Everything here is
// strictly scoped to the connection's OWN selected ad account: every Meta
// write re-fetches the entity and compares its account_id against the
// stored selection before touching it, and every Google mutate is
// addressed to the selected customer id in the URL path. Writes always
// return { oldValue, newValue, apiResult } so the caller can audit-log.
//
// Money units: this module speaks DOLLARS at its boundary. Meta stores
// budgets/bids in minor units (cents) and Google in micros - converted
// here, never in the UI.
const fetch = require('node-fetch');
const { metaGet, readRow } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { gadsSearch, gadsMutate } = require('./_googleAds');

const GRAPH = 'https://graph.facebook.com/v19.0';

// Budget guardrails: an extra confirmation is required for changes larger
// than ±50% or any budget above the ceiling (per day / lifetime alike).
const GUARDRAIL_PCT = 50;
const BUDGET_CEILING = Number(process.env.MANAGE_BUDGET_CEILING || 1000);

function guardrail(action, oldValue, newValue) {
  if (action !== 'set_budget') return null;
  const reasons = [];
  if (oldValue > 0) {
    const pct = Math.abs(((newValue - oldValue) / oldValue) * 100);
    if (pct > GUARDRAIL_PCT) reasons.push(`that changes the budget by ${Math.round(pct)}% (guardrail: ±${GUARDRAIL_PCT}%)`);
  }
  if (newValue > BUDGET_CEILING) reasons.push(`$${newValue} is above the $${BUDGET_CEILING} budget ceiling`);
  return reasons.length ? reasons.join('; ') : null;
}

// Retry a call once after a rate-limit style failure.
async function withBackoff(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = `${err.status || ''} ${err.message || ''}`;
    if (/429|rate.?limit|too many|user request limit/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 1500));
      return fn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------- Meta ---

const centsToDollars = (v) => (v == null || v === '' ? null : +(Number(v) / 100).toFixed(2));
const dollarsToCents = (v) => Math.round(Number(v) * 100);

// Meta extras the master metrics config can switch on; reach rides as an
// insights field, the rest are action types read alongside the selected
// conversion events, so every nesting level carries the full column set.
const META_EXTRA_ACTIONS = ['video_view', 'video_thruplay_watched', 'post_engagement'];

function metaRowMetrics(entity, metricIds, primaryId) {
  const ins = (entity.insights && entity.insights.data && entity.insights.data[0]) || {};
  const r = readRow(ins, metricIds);
  const conversions = r.values[primaryId] || 0;
  return {
    spend: +r.spend.toFixed(2),
    impressions: r.impressions,
    clicks: r.clicks,
    reach: parseInt(ins.reach || 0, 10) || null,
    ctr: r.impressions > 0 ? +((r.clicks / r.impressions) * 100).toFixed(2) : null,
    cpc: r.clicks > 0 ? +(r.spend / r.clicks).toFixed(2) : null,
    conversions,
    cpa: conversions > 0 ? +(r.spend / conversions).toFixed(2) : null,
    roas: r.spend > 0 && r.revenue > 0 ? +(r.revenue / r.spend).toFixed(2) : null,
    events: r.values
  };
}

async function metaTree(meta, since, until) {
  const selected = getSelectedMetrics(meta);
  const primary = selected[0];
  const metricIds = [...selected.map((m) => m.id), ...META_EXTRA_ACTIONS];
  const insights = `insights.time_range({"since":"${since}","until":"${until}"}){spend,impressions,clicks,reach,actions,action_values}`;
  const base = { time: 'x', access_token: meta.accessToken, limit: 200 };
  const [campaigns, adsets, ads] = await Promise.all([
    metaGet(`${meta.selectedAdAccountId}/campaigns`, {
      fields: `name,status,effective_status,daily_budget,lifetime_budget,${insights}`,
      access_token: meta.accessToken,
      limit: 200
    }),
    metaGet(`${meta.selectedAdAccountId}/adsets`, {
      fields: `name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_amount,${insights}`,
      access_token: meta.accessToken,
      limit: 500
    }),
    metaGet(`${meta.selectedAdAccountId}/ads`, {
      fields: `name,status,effective_status,adset_id,${insights}`,
      access_token: meta.accessToken,
      limit: 500
    })
  ]);
  void base;

  const node = (e, type, extra = {}) => ({
    id: e.id,
    type,
    name: e.name,
    status: e.status === 'ACTIVE' ? 'active' : 'paused',
    effectiveStatus: e.effective_status || e.status,
    metrics: metaRowMetrics(e, metricIds, primary.id),
    ...extra,
    children: []
  });

  const budgetOf = (e) =>
    e.daily_budget != null && e.daily_budget !== ''
      ? { type: 'daily', amount: centsToDollars(e.daily_budget) }
      : e.lifetime_budget != null && e.lifetime_budget !== ''
        ? { type: 'lifetime', amount: centsToDollars(e.lifetime_budget) }
        : null;

  const campaignNodes = new Map();
  campaigns.forEach((c) => campaignNodes.set(c.id, node(c, 'campaign', { budget: budgetOf(c), editableBudget: budgetOf(c) !== null })));
  const adsetNodes = new Map();
  adsets.forEach((a) => {
    const n = node(a, 'adset', {
      budget: budgetOf(a),
      editableBudget: budgetOf(a) !== null,
      bid: a.bid_amount != null && a.bid_amount !== '' ? centsToDollars(a.bid_amount) : null,
      editableBid: a.bid_amount != null && a.bid_amount !== ''
    });
    adsetNodes.set(a.id, n);
    const parent = campaignNodes.get(a.campaign_id);
    if (parent) parent.children.push(n);
  });
  ads.forEach((a) => {
    const parent = adsetNodes.get(a.adset_id);
    if (parent) parent.children.push(node(a, 'ad'));
  });
  return { primaryMetric: primary.label, campaigns: [...campaignNodes.values()] };
}

// Fetch one Meta entity's identity + current values, verifying it belongs
// to the connection's selected ad account before anything is written.
async function metaEntity(meta, entityId) {
  const params = new URLSearchParams({
    fields: 'name,status,account_id,daily_budget,lifetime_budget,bid_amount',
    access_token: meta.accessToken
  });
  const res = await fetch(`${GRAPH}/${entityId}?${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Meta API request failed.');
  if (`act_${json.account_id}` !== meta.selectedAdAccountId) {
    const err = new Error('That entity does not belong to the connected ad account.');
    err.forbidden = true;
    throw err;
  }
  return json;
}

async function metaWrite(meta, entityId, params) {
  const body = new URLSearchParams({ ...params, access_token: meta.accessToken });
  const res = await fetch(`${GRAPH}/${entityId}`, { method: 'POST', body });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'Meta API write failed.');
    err.status = json.error.code;
    throw err;
  }
  return json;
}

// -------------------------------------------------------------- Google ---

const microsToDollars = (v) => (v == null ? null : +(Number(v) / 1e6).toFixed(2));
const dollarsToMicros = (v) => Math.round(Number(v) * 1e6);

const gMetrics = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value';

// Per-entity counts of each selected conversion action, one query per
// nesting level. Returns entityId -> { actionResourceName: count }.
async function googleEventMaps(google, cid, during, opts) {
  const selected = google.selectedMetrics || [];
  if (!selected.length) return { campaign: {}, adgroup: {}, ad: {}, primaryId: null };
  const wanted = new Set(selected.map((m) => m.id));
  const q = (from, idField) =>
    `SELECT ${idField}, segments.conversion_action, metrics.all_conversions FROM ${from} WHERE ${during}`;
  const [camps, groups, ads] = await Promise.all([
    gadsSearch(google, cid, q('campaign', 'campaign.id'), opts),
    gadsSearch(google, cid, q('ad_group', 'ad_group.id'), opts),
    gadsSearch(google, cid, q('ad_group_ad', 'ad_group_ad.ad.id, ad_group.id'), opts)
  ]);
  const collect = (results, idOf) => {
    const map = {};
    results.forEach((row) => {
      const action = row.segments && row.segments.conversionAction;
      if (!action || !wanted.has(action)) return;
      const id = idOf(row);
      if (!id) return;
      const slot = (map[id] = map[id] || {});
      slot[action] = +((slot[action] || 0) + Number((row.metrics || {}).allConversions || 0)).toFixed(1);
    });
    return map;
  };
  return {
    campaign: collect(camps.results, (r) => String((r.campaign || {}).id || '')),
    adgroup: collect(groups.results, (r) => String((r.adGroup || {}).id || '')),
    ad: collect(ads.results, (r) => String(((r.adGroupAd || {}).ad || {}).id || '')),
    primaryId: selected[0].id
  };
}

function googleRowMetrics(m = {}) {
  const spend = Number(m.costMicros || 0) / 1e6;
  const clicks = parseInt(m.clicks || 0, 10);
  const impressions = parseInt(m.impressions || 0, 10);
  const conversions = +Number(m.conversions || 0).toFixed(1);
  const value = Number(m.conversionsValue || 0);
  return {
    spend: +spend.toFixed(2),
    impressions,
    clicks,
    ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null,
    cpc: clicks > 0 ? +(spend / clicks).toFixed(2) : null,
    conversions,
    cpa: conversions > 0 ? +(spend / conversions).toFixed(2) : null,
    roas: spend > 0 && value > 0 ? +(value / spend).toFixed(2) : null
  };
}

async function googleTree(google, since, until) {
  const cid = google.selectedAdAccountId;
  const account = (google.adAccounts || []).find((a) => a.id === cid);
  const opts = { loginCustomerId: account && account.loginCustomerId };
  const during = `segments.date BETWEEN '${since}' AND '${until}'`;
  const [camps, groups, adsRes, eventMaps] = await Promise.all([
    gadsSearch(google, cid, `SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign.bidding_strategy_type, campaign_budget.amount_micros, ${gMetrics} FROM campaign WHERE campaign.status != 'REMOVED' AND ${during}`, opts),
    gadsSearch(google, cid, `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.target_cpa_micros, campaign.id, ${gMetrics} FROM ad_group WHERE ad_group.status != 'REMOVED' AND ${during}`, opts),
    gadsSearch(google, cid, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id, ${gMetrics} FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ${during}`, opts),
    googleEventMaps(google, cid, during, opts).catch((err) => {
      console.error(`[googleTree] event maps failed: ${err.message}`);
      return { campaign: {}, adgroup: {}, ad: {}, primaryId: null };
    })
  ]);

  // With a mapped primary result, the headline conversions/cpa columns count
  // THAT action - not Google's blended "conversions" metric.
  const withEvents = (metrics, level, id) => {
    const events = eventMaps[level][id] || {};
    const out = { ...metrics, events };
    if (eventMaps.primaryId) {
      const conversions = +(events[eventMaps.primaryId] || 0).toFixed(1);
      out.conversions = conversions;
      out.cpa = conversions > 0 ? +(metrics.spend / conversions).toFixed(2) : null;
    }
    return out;
  };

  const status = (s) => (s === 'ENABLED' ? 'active' : 'paused');
  const campaignNodes = new Map();
  camps.results.forEach((row) => {
    const c = row.campaign;
    campaignNodes.set(String(c.id), {
      id: String(c.id),
      type: 'campaign',
      name: c.name,
      status: status(c.status),
      effectiveStatus: c.status,
      budget: { type: 'daily', amount: microsToDollars((row.campaignBudget || {}).amountMicros) },
      editableBudget: true,
      budgetResource: c.campaignBudget,
      biddingStrategy: c.biddingStrategyType,
      metrics: withEvents(googleRowMetrics(row.metrics), 'campaign', String(c.id)),
      children: []
    });
  });
  const groupNodes = new Map();
  groups.results.forEach((row) => {
    const g = row.adGroup;
    const n = {
      id: String(g.id),
      type: 'adgroup',
      name: g.name,
      status: status(g.status),
      effectiveStatus: g.status,
      budget: null,
      editableBudget: false, // Google budgets live on the campaign
      bid: g.cpcBidMicros ? microsToDollars(g.cpcBidMicros) : g.targetCpaMicros ? microsToDollars(g.targetCpaMicros) : null,
      bidKind: g.cpcBidMicros ? 'cpc' : g.targetCpaMicros ? 'target_cpa' : null,
      editableBid: !!(g.cpcBidMicros || g.targetCpaMicros),
      metrics: withEvents(googleRowMetrics(row.metrics), 'adgroup', String(g.id)),
      children: []
    };
    groupNodes.set(String(g.id), n);
    const parent = campaignNodes.get(String(row.campaign.id));
    if (parent) parent.children.push(n);
  });
  adsRes.results.forEach((row) => {
    const ad = row.adGroupAd.ad || {};
    const parent = groupNodes.get(String(row.adGroup.id));
    if (parent) {
      parent.children.push({
        id: String(ad.id),
        type: 'ad',
        name: ad.name || `Ad ${ad.id}`,
        status: status(row.adGroupAd.status),
        effectiveStatus: row.adGroupAd.status,
        metrics: withEvents(googleRowMetrics(row.metrics), 'ad', String(ad.id)),
        children: []
      });
    }
  });
  const primaryLabel = (google.selectedMetrics || [])[0];
  return { primaryMetric: primaryLabel ? primaryLabel.label : 'Conversions', campaigns: [...campaignNodes.values()] };
}

// Google entity lookup for a write: verifies it exists on THIS customer and
// returns current values (existence on the addressed customer id is the
// ownership check - the mutate URL is scoped to the same id).
const G_LOOKUP = {
  campaign: (id) => `SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${id}`,
  adgroup: (id) => `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.target_cpa_micros FROM ad_group WHERE ad_group.id = ${id}`,
  ad: (id) => `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.name, ad_group.id FROM ad_group_ad WHERE ad_group_ad.ad.id = ${id}`
};

// ------------------------------------------------------------ execute ---

// One validated write. input: { channel, entityType, entityId, action,
// value, acknowledged }. Returns { needsAck } when a guardrail wants an
// extra confirmation, else { entityName, oldValue, newValue, apiResult }.
async function executeWrite(user, input) {
  const { channel, entityType, entityId, action } = input;
  const value = input.value;

  if (channel === 'meta') {
    const meta = user.accounts.meta;
    if (!meta || !meta.selectedAdAccountId) throw new Error('Meta is not connected.');
    if (meta.canManage === false) {
      const err = new Error('This Meta connection is read-only - reconnect with a user who can manage ads.');
      err.readOnly = true;
      throw err;
    }
    const entity = await metaEntity(meta, entityId);

    if (action === 'set_status') {
      const next = value === 'active' ? 'ACTIVE' : 'PAUSED';
      const apiResult = await withBackoff(() => metaWrite(meta, entityId, { status: next }));
      return { entityName: entity.name, oldValue: entity.status, newValue: next, apiResult: JSON.stringify(apiResult) };
    }
    if (action === 'set_budget') {
      const field = entity.lifetime_budget && !entity.daily_budget ? 'lifetime_budget' : 'daily_budget';
      const oldValue = centsToDollars(entity[field]);
      if (oldValue == null) throw new Error('This entity has no editable budget (it may inherit a campaign budget).');
      if (input.probe) return { probe: true, entityName: entity.name, currentBudget: oldValue };
      const warn = guardrail(action, oldValue, value);
      if (warn && !input.acknowledged) return { needsAck: true, reason: warn, entityName: entity.name, oldValue, newValue: value };
      const apiResult = await withBackoff(() => metaWrite(meta, entityId, { [field]: String(dollarsToCents(value)) }));
      return { entityName: entity.name, oldValue: `$${oldValue}`, newValue: `$${value}`, apiResult: JSON.stringify(apiResult) };
    }
    if (action === 'set_bid') {
      const oldValue = centsToDollars(entity.bid_amount);
      if (oldValue == null) throw new Error("This ad set's bid strategy doesn't use a manual bid.");
      const apiResult = await withBackoff(() => metaWrite(meta, entityId, { bid_amount: String(dollarsToCents(value)) }));
      return { entityName: entity.name, oldValue: `$${oldValue}`, newValue: `$${value}`, apiResult: JSON.stringify(apiResult) };
    }
    throw new Error('Unknown action.');
  }

  if (channel === 'google') {
    const google = user.accounts.google;
    if (!google || !google.selectedAdAccountId) throw new Error('Google Ads is not connected.');
    const cid = google.selectedAdAccountId;
    const account = (google.adAccounts || []).find((a) => a.id === cid);
    const opts = { loginCustomerId: account && account.loginCustomerId };

    const lookup = G_LOOKUP[entityType];
    if (!lookup) throw new Error('Unknown entity type.');
    const found = await gadsSearch(google, cid, lookup(entityId), opts);
    if (!found.results.length) {
      const err = new Error('That entity does not belong to the connected ad account.');
      err.forbidden = true;
      throw err;
    }
    const row = found.results[0];

    if (action === 'set_status') {
      const next = value === 'active' ? 'ENABLED' : 'PAUSED';
      const map = {
        campaign: { collection: 'campaigns', resource: `customers/${cid}/campaigns/${entityId}`, old: row.campaign && row.campaign.status, name: row.campaign && row.campaign.name },
        adgroup: { collection: 'adGroups', resource: `customers/${cid}/adGroups/${entityId}`, old: row.adGroup && row.adGroup.status, name: row.adGroup && row.adGroup.name },
        ad: { collection: 'adGroupAds', resource: `customers/${cid}/adGroupAds/${row.adGroup.id}~${entityId}`, old: row.adGroupAd && row.adGroupAd.status, name: (row.adGroupAd && row.adGroupAd.ad && row.adGroupAd.ad.name) || `Ad ${entityId}` }
      }[entityType];
      const apiResult = await withBackoff(() =>
        gadsMutate(google, cid, map.collection, [{ updateMask: 'status', update: { resourceName: map.resource, status: next } }], opts)
      );
      return { entityName: map.name, oldValue: map.old, newValue: next, apiResult: JSON.stringify(apiResult.results) };
    }
    if (action === 'set_budget') {
      if (entityType !== 'campaign') throw new Error('Google budgets are set on the campaign (ad groups inherit it).');
      const budgetResource = row.campaign.campaignBudget;
      const oldValue = microsToDollars((row.campaignBudget || {}).amountMicros);
      if (input.probe) return { probe: true, entityName: row.campaign.name, currentBudget: oldValue };
      const warn = guardrail(action, oldValue || 0, value);
      if (warn && !input.acknowledged) return { needsAck: true, reason: warn, entityName: row.campaign.name, oldValue, newValue: value };
      const apiResult = await withBackoff(() =>
        gadsMutate(google, cid, 'campaignBudgets', [{ updateMask: 'amount_micros', update: { resourceName: budgetResource, amountMicros: String(dollarsToMicros(value)) } }], opts)
      );
      return { entityName: row.campaign.name, oldValue: `$${oldValue}`, newValue: `$${value}`, apiResult: JSON.stringify(apiResult.results) };
    }
    if (action === 'set_bid') {
      if (entityType !== 'adgroup') throw new Error('Bids are edited on the ad group.');
      const g = row.adGroup;
      const kind = g.cpcBidMicros ? 'cpc_bid_micros' : g.targetCpaMicros ? 'target_cpa_micros' : null;
      if (!kind) throw new Error("This ad group's bid strategy doesn't allow a manual bid or target CPA.");
      const oldValue = microsToDollars(g.cpcBidMicros || g.targetCpaMicros);
      const field = kind === 'cpc_bid_micros' ? 'cpcBidMicros' : 'targetCpaMicros';
      const apiResult = await withBackoff(() =>
        gadsMutate(google, cid, 'adGroups', [{ updateMask: kind, update: { resourceName: `customers/${cid}/adGroups/${entityId}`, [field]: String(dollarsToMicros(value)) } }], opts)
      );
      return { entityName: g.name, oldValue: `$${oldValue}`, newValue: `$${value}`, apiResult: JSON.stringify(apiResult.results) };
    }
    throw new Error('Unknown action.');
  }

  throw new Error('Unknown channel.');
}

module.exports = { metaTree, googleTree, executeWrite, guardrail, GUARDRAIL_PCT, BUDGET_CEILING };
