// Shared helpers for calling the Meta Graph API insights endpoints. Every
// caller already holds a long-lived user access token saved by the OAuth
// callback; these helpers only read reporting data (ads_read scope).
const fetch = require('node-fetch');
const { extractValues } = require('./_metrics');

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

// Pulls spend plus each requested metric's value out of one insights row.
function readRow(row, metricIds) {
  return {
    spend: parseFloat(row.spend || 0),
    values: extractValues(row, metricIds)
  };
}

function sumRows(rows, metricIds) {
  const totals = { spend: 0, values: {} };
  metricIds.forEach((id) => {
    totals.values[id] = 0;
  });
  rows.forEach((row) => {
    const r = readRow(row, metricIds);
    totals.spend += r.spend;
    metricIds.forEach((id) => {
      totals.values[id] += r.values[id];
    });
  });
  return totals;
}

function costPer(spend, count) {
  return count ? +(spend / count).toFixed(2) : 0;
}

module.exports = { metaGet, readRow, sumRows, costPer };
