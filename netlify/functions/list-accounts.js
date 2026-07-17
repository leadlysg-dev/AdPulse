const { getEmailFromRequest, getWorkspaceFromRequest, getDataUser } = require('./_store');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  const user = await getDataUser(email, await getWorkspaceFromRequest(event.headers, email));
  const meta = user.accounts.meta || { adAccounts: [], selectedAdAccountId: null };
  const google = user.accounts.google || { adAccounts: [], selectedAdAccountId: null };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meta: { adAccounts: meta.adAccounts, selectedAdAccountId: meta.selectedAdAccountId },
      google: { adAccounts: google.adAccounts, selectedAdAccountId: google.selectedAdAccountId }
    })
  };
};
