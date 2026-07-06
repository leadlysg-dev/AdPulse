const { getEmailFromRequest, getUser, hasSetPassword } = require('./_store');

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
      metaConnected: !!meta,
      metaNeedsPick: !!meta && meta.adAccounts.length > 1 && !meta.selectedAdAccountId,
      // Sent to the metric picker once, right after the account is chosen.
      // Accounts predating the picker aren't flagged here per se - they
      // also have no selectedMetrics, which is exactly the nudge we want,
      // and until they save one they default to Leads everywhere.
      metaNeedsMetrics:
        !!meta && !!meta.selectedAdAccountId && !(meta.selectedMetrics && meta.selectedMetrics.length),
      googleConnected: !!google,
      googleNeedsPick: !!google && google.adAccounts.length > 1 && !google.selectedAdAccountId,
      // For the Settings page: "Change password" vs "Set password", and the
      // saved AI preferences (null until first saved).
      hasPassword: hasSetPassword(user),
      aiPrefs: user.aiPrefs || null
    })
  };
};
