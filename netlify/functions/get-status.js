const { getEmailFromRequest, getUser, hasSetPassword, isPlatformAdmin } = require('./_store');

// Friendly name of the selected ad account on a connection, for Settings.
function selectedAccountName(conn) {
  if (!conn || !conn.selectedAdAccountId) return null;
  const acc = (conn.adAccounts || []).find((a) => a.id === conn.selectedAdAccountId);
  return (acc && acc.name) || conn.selectedAdAccountId;
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loggedIn: false })
    };
  }

  const user = await getUser(email);
  const meta = user.accounts.meta;
  const google = user.accounts.google;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loggedIn: true,
      email: user.email,
      isPlatformAdmin: await isPlatformAdmin(user.email).catch(() => false),
      metaConnected: !!meta,
      metaNeedsPick: !!meta && meta.adAccounts.length > 1 && !meta.selectedAdAccountId,
      metaAccountName: selectedAccountName(meta),
      googleConnected: !!google,
      googleNeedsPick: !!google && google.adAccounts.length > 1 && !google.selectedAdAccountId,
      googleAccountName: selectedAccountName(google),
      // Primary tracked metric per platform (kept in sync with the master
      // metrics config), for metric-aware alert presets.
      metaPrimaryMetric: (meta && meta.selectedMetrics && meta.selectedMetrics[0]) || { id: 'lead', label: 'Leads' },
      googlePrimaryMetric: (google && google.selectedMetrics && google.selectedMetrics[0]) || null,
      // For the Settings page: "Change password" vs "Set password".
      hasPassword: hasSetPassword(user),
      // AI behaviour defaults saved by the retired preferences UI are kept
      // server-side so current chat behaviour doesn't change.
      aiPrefs: user.aiPrefs || null
    })
  };
};
