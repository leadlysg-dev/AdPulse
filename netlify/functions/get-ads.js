// Active ads with their creative preview (thumbnail + headline/body) and
// per-ad performance for the selected date range, reported against the
// customer's own selected metrics. Two Meta calls: one for per-ad insights,
// one for the active ads' creatives, joined by ad id. ads_read covers both.
// Demo data when no account is connected.
const { getEmailFromRequest, getUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange } = require('./_dates');
const { metaGet, readRow } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { gadsSearch } = require('./_googleAds');
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
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';

  const user = await getUser(email);
  const meta = user.accounts.meta;
  if (!meta || !meta.selectedAdAccountId) {
    return json(200, demoAds(range));
  }

  const selectedMetrics = getSelectedMetrics(meta);
  const metricIds = selectedMetrics.map((m) => m.id);
  const { since, until } = custom || resolveRange(range);

  try {
    const [adRows, insightRows] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/ads`, {
        fields: 'id,name,effective_status,creative{thumbnail_url,image_url,title,body}',
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
      metricsByAd[row.ad_id] = readRow(row, metricIds);
    });

    const zeroValues = Object.fromEntries(metricIds.map((id) => [id, 0]));

    const ads = adRows
      .map((ad) => {
        const m = metricsByAd[ad.id] || { spend: 0, values: zeroValues };
        const creative = ad.creative || {};
        return {
          id: ad.id,
          name: ad.name,
          headline: creative.title || null,
          body: creative.body || null,
          thumbnailUrl: creative.thumbnail_url || null,
          imageUrl: creative.image_url || null,
          spend: +m.spend.toFixed(2),
          values: m.values
        };
      })
      .sort((a, b) => b.spend - a.spend);

    // Google ad previews ride along when Google is reporting: enabled ads
    // with their responsive-ad text (and image URL where the ad has one),
    // spend and conversions. Failure degrades to Meta-only, never an error.
    let googleAds = [];
    let googleStatus = 'not-connected';
    const google = user.accounts.google;
    if (google && google.selectedAdAccountId) {
      googleStatus = 'ok';
      try {
        const account = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
        const { results } = await gadsSearch(
          google,
          google.selectedAdAccountId,
          'SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ' +
            'ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ' +
            'ad_group_ad.ad.image_ad.image_url, campaign.name, ' +
            'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions ' +
            `FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}' ` +
            "AND ad_group_ad.status = 'ENABLED' ORDER BY metrics.cost_micros DESC LIMIT 30",
          { loginCustomerId: account && account.loginCustomerId }
        );
        googleAds = results.map((row) => {
          const ad = (row.adGroupAd && row.adGroupAd.ad) || {};
          const rsa = ad.responsiveSearchAd || {};
          const m = row.metrics || {};
          return {
            id: String(ad.id || ''),
            platform: 'google',
            name: ad.name || (row.campaign && row.campaign.name) || 'Google ad',
            headline: (rsa.headlines && rsa.headlines[0] && rsa.headlines[0].text) || null,
            body: (rsa.descriptions && rsa.descriptions[0] && rsa.descriptions[0].text) || null,
            imageUrl: (ad.imageAd && ad.imageAd.imageUrl) || null,
            thumbnailUrl: null,
            spend: +(Number(m.costMicros || 0) / 1e6).toFixed(2),
            impressions: parseInt(m.impressions || 0, 10),
            clicks: parseInt(m.clicks || 0, 10),
            conversions: +Number(m.allConversions || 0).toFixed(1)
          };
        });
      } catch (err) {
        console.error(`[get-ads] Google ads fetch failed: ${err.message}`);
        googleStatus = 'error';
      }
    }

    return json(200, { isDemo: false, range, metrics: selectedMetrics, ads, googleAds, googleStatus });
  } catch (err) {
    return json(502, { error: 'Could not fetch your ads from Meta. ' + err.message });
  }
};
