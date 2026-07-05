// Shared helpers for calling the Meta Graph API insights endpoints. Every
// caller already holds a long-lived user access token saved by the OAuth
// callback; these helpers only read reporting data (ads_read scope).
const fetch = require('node-fetch');

const GRAPH = 'https://graph.facebook.com/v19.0';

// Calls an insights-style edge and returns the data array. Throws with the
// API's own error message so callers can surface something meaningful.
async function metaGet(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${GRAPH}/${path}?${qs.toString()}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || 'Meta API request failed.');
  }
  return json.data || [];
}

// Pulls spend + lead count out of one insights row.
function readRow(row) {
  const leadAction = (row.actions || []).find((a) => a.action_type === 'lead');
  return {
    spend: parseFloat(row.spend || 0),
    leads: leadAction ? parseInt(leadAction.value, 10) : 0
  };
}

function sumRows(rows) {
  return rows.reduce(
    (acc, row) => {
      const r = readRow(row);
      acc.spend += r.spend;
      acc.leads += r.leads;
      return acc;
    },
    { spend: 0, leads: 0 }
  );
}

function costPerLead(spend, leads) {
  return leads ? +(spend / leads).toFixed(2) : 0;
}

module.exports = { metaGet, readRow, sumRows, costPerLead };
