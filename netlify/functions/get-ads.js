// Active ads with their creative preview (thumbnail + headline/body) and
// per-ad performance for the selected date range. Two Meta calls: one for
// per-ad insights, one for the active ads' creatives, joined by ad id.
// ads_read covers both - no extra permissions. Demo data when no account
// is connected.
const { getEmailFromRequest, getUser } = require('./_store');
const { VALID_RANGES, resolveRange } = require('./_dates');
const { metaGet, readRow, costPerLead } = require('./_meta');
const { demoAds } = require('./_demo');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const range = VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';

  const user = await getUser(email);
  const meta = user.accounts.meta;
  if (!meta || !meta.selectedAdAccountId) {
    return json(200, demoAds(range));
  }

  const { since, until } = resolveRange(range);

  try {
    const [adRows, insightRows] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/ads`, {
        fields: 'id,name,effective_status,creative{thumbnail_url,title,body}',
        effective_status: JSON.stringify(['ACTIVE']),
        limit: 50,
        access_token: meta.accessToken
      }),
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'ad_id,spend,actions',
        level: 'ad',
        time_range: JSON.stringify({ since, until }),
        limit: 100,
        access_token: meta.accessToken
      })
    ]);

    const metricsByAd = {};
    insightRows.forEach((row) => {
      metricsByAd[row.ad_id] = readRow(row);
    });

    const ads = adRows
      .map((ad) => {
        const m = metricsByAd[ad.id] || { spend: 0, leads: 0 };
        const creative = ad.creative || {};
        return {
          id: ad.id,
          name: ad.name,
          headline: creative.title || null,
          body: creative.body || null,
          thumbnailUrl: creative.thumbnail_url || null,
          spend: +m.spend.toFixed(2),
          leads: m.leads,
          costPerLead: costPerLead(m.spend, m.leads)
        };
      })
      .sort((a, b) => b.spend - a.spend);

    return json(200, { isDemo: false, range, ads });
  } catch (err) {
    return json(502, { error: 'Could not fetch your ads from Meta. ' + err.message });
  }
};
