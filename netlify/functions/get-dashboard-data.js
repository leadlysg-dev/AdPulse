// Pulls the customer's real Meta + Google Ads numbers if they've connected an account.
// Falls back to labelled demo data so the dashboard still looks right before they connect
// (useful for demos and for testing your own build without live ad spend).
const fetch = require('node-fetch');
const { getOrCreateSessionId, getTokens } = require('./_store');

const DEMO_DATA = {
  isDemo: true,
  leads: 142,
  spend: 3840,
  costPerLead: 27.04,
  metaSpend: 2410,
  googleSpend: 1430,
  weekly: {
    labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
    leads: [18, 22, 24, 29, 33, 38],
    spend: [620, 680, 710, 790, 880, 940]
  }
};

async function getMetaSummary(accessToken) {
  // NOTE: this reads the first ad account available to the token. A production
  // build should let the customer pick which ad account if they manage several.
  const acctRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${accessToken}`);
  const acctData = await acctRes.json();
  const account = acctData.data && acctData.data[0];
  if (!account) return null;

  const insightsRes = await fetch(
    `https://graph.facebook.com/v19.0/${account.id}/insights?fields=spend,actions&date_preset=last_30d&access_token=${accessToken}`
  );
  const insights = await insightsRes.json();
  const row = insights.data && insights.data[0];
  if (!row) return { spend: 0, leads: 0 };

  const leadAction = (row.actions || []).find((a) => a.action_type === 'lead');
  return {
    spend: parseFloat(row.spend || 0),
    leads: leadAction ? parseInt(leadAction.value, 10) : 0
  };
}

exports.handler = async (event) => {
  const { sid } = getOrCreateSessionId(event.headers);
  const tokens = await getTokens(sid);

  if (!tokens.meta && !tokens.google) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEMO_DATA)
    };
  }

  try {
    let metaSummary = { spend: 0, leads: 0 };
    if (tokens.meta) {
      metaSummary = (await getMetaSummary(tokens.meta.accessToken)) || metaSummary;
    }

    // Google Ads API calls require the Google Ads client library and a selected
    // customer (account) ID - wired up separately once the customer picks an account.
    // Left as 0 here until that account-selection step is built.
    const googleSummary = { spend: 0, leads: 0 };

    const totalLeads = metaSummary.leads + googleSummary.leads;
    const totalSpend = metaSummary.spend + googleSummary.spend;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isDemo: false,
        leads: totalLeads,
        spend: totalSpend,
        costPerLead: totalLeads ? +(totalSpend / totalLeads).toFixed(2) : 0,
        metaSpend: metaSummary.spend,
        googleSpend: googleSummary.spend,
        weekly: DEMO_DATA.weekly // replace with real weekly breakdown once both APIs are fully wired
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DEMO_DATA, error: 'Could not fetch live data, showing demo data instead.' })
    };
  }
};
