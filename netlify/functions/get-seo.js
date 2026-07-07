// Search Console data for the SEO tab: clicks/impressions/CTR/average
// position for the selected date range (with vs-previous deltas), a daily
// series for the charts, and top queries + top pages tables. Reuses the
// Google connection's stored tokens - no separate auth.
//
// The response's `state` tells the tab what to show:
//   ok               - data included
//   not-connected    - no Google connection at all
//   needs-reconnect  - connected before the Search Console scope existed
//   sc-api-disabled  - scope is granted but the Search Console API is turned
//                      off on the OAuth client's Google Cloud project
//   no-properties    - scope granted but no Search Console properties
//   needs-site       - properties listed but none picked yet (list included)
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange, listDays } = require('./_dates');
const { listScProperties, scQuery } = require('./_google');
const { demoSeo } = require('./_demo');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// Collapse rows into period totals. Average position is weighted by
// impressions, matching how Search Console itself aggregates.
function totalsFrom(rows) {
  let clicks = 0;
  let impressions = 0;
  let positionWeight = 0;
  rows.forEach((r) => {
    clicks += r.clicks || 0;
    impressions += r.impressions || 0;
    positionWeight += (r.position || 0) * (r.impressions || 0);
  });
  return {
    clicks,
    impressions,
    ctrPct: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : null,
    avgPosition: impressions > 0 ? +(positionWeight / impressions).toFixed(1) : null
  };
}

function tableRows(rows) {
  return rows.map((r) => ({
    key: r.keys?.[0] || '',
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctrPct: r.impressions > 0 ? +((r.clicks / r.impressions) * 100).toFixed(2) : null,
    avgPosition: r.position != null ? +r.position.toFixed(1) : null
  }));
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const user = await getUser(email);
  if (!user) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';
  const { since, until, prevSince, prevUntil } = custom || resolveRange(range);

  const google = user.accounts.google;
  if (!google) {
    // Nothing connected: labelled sample data so the tab never looks broken.
    return json(200, { state: 'ok', isDemo: true, ...demoSeo(range, custom) });
  }

  try {
    // Refresh the property list when it was never stored (connections that
    // predate the SEO feature) so users don't have to reconnect needlessly -
    // a null list means the token itself lacks the scope.
    let properties = google.scProperties || null;
    let dirty = false;
    if (!properties) {
      const listed = await listScProperties(google);
      dirty = listed.tokenRefreshed;
      if (listed.properties === null) {
        if (dirty) await saveUser(user);
        console.error(
          `[get-seo] Search Console listing denied: status=${listed.status} reason=${listed.reason} ${listed.message}`
        );
        // accessNotConfigured = the Search Console API is disabled on the
        // OAuth client's Google Cloud project. The scope is fine and
        // reconnecting can never fix it - only enabling the API can, so
        // don't send the user back through consent for nothing.
        if (listed.reason === 'accessNotConfigured' || /not been used in project|is disabled/i.test(listed.message)) {
          return json(200, { state: 'sc-api-disabled' });
        }
        return json(200, { state: 'needs-reconnect' });
      }
      properties = listed.properties;
      google.scProperties = properties;
      if (properties.length === 1 && !google.selectedScSiteUrl) {
        google.selectedScSiteUrl = properties[0].siteUrl;
      }
      dirty = true;
    }

    if (properties.length === 0) {
      if (dirty) await saveUser(user);
      return json(200, { state: 'no-properties' });
    }
    if (!google.selectedScSiteUrl) {
      if (dirty) await saveUser(user);
      return json(200, { state: 'needs-site', properties });
    }

    const site = google.selectedScSiteUrl;
    const [daily, prev, queries, pages] = await Promise.all([
      scQuery(google, site, { startDate: since, endDate: until, dimensions: ['date'], rowLimit: 400 }),
      scQuery(google, site, { startDate: prevSince, endDate: prevUntil, dimensions: ['date'], rowLimit: 400 }),
      scQuery(google, site, { startDate: since, endDate: until, dimensions: ['query'], rowLimit: 10 }),
      scQuery(google, site, { startDate: since, endDate: until, dimensions: ['page'], rowLimit: 10 })
    ]);
    if (dirty || daily.tokenRefreshed) await saveUser(user);

    if ([daily, prev, queries, pages].some((r) => r.status === 401 || r.status === 403)) {
      const denied = [daily, prev, queries, pages].find((r) => r.status === 401 || r.status === 403);
      console.error(
        `[get-seo] Search Console query denied: status=${denied.status} ${JSON.stringify(denied.json.error || {})}`
      );
      return json(200, { state: 'needs-reconnect' });
    }
    if ([daily, prev, queries, pages].some((r) => r.status >= 400)) {
      return json(200, { state: 'unavailable' });
    }

    // Fill day gaps so the chart shows a continuous timeline.
    const byDate = {};
    (daily.json.rows || []).forEach((r) => {
      byDate[r.keys?.[0]] = r;
    });
    const dates = listDays(since, until);
    const series = {
      dates,
      clicks: dates.map((d) => byDate[d]?.clicks || 0),
      impressions: dates.map((d) => byDate[d]?.impressions || 0),
      avgPosition: dates.map((d) => (byDate[d]?.position != null ? +byDate[d].position.toFixed(1) : 0))
    };

    return json(200, {
      state: 'ok',
      isDemo: false,
      range,
      since,
      until,
      siteUrl: site,
      totals: totalsFrom(daily.json.rows || []),
      previous: totalsFrom(prev.json.rows || []),
      daily: series,
      topQueries: tableRows(queries.json.rows || []),
      topPages: tableRows(pages.json.rows || [])
    });
  } catch (err) {
    return json(200, { state: 'unavailable' });
  }
};
