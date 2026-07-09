// Posts the owner reply on one review from the dashboard.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { replyToReview } = require('./_gbp');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid request body.' };
  }
  const { reviewId, comment } = body;
  const text = typeof comment === 'string' ? comment.trim().slice(0, 4000) : '';
  if (!reviewId || !text) return { statusCode: 400, body: 'Reply text is required.' };

  const user = await getUser(email);
  const gbp = user && user.accounts.gbp;
  if (!gbp || !gbp.selectedAdAccountId) return { statusCode: 400, body: 'Business Profile is not connected yet.' };

  const res = await replyToReview(gbp, gbp.selectedAdAccountId, reviewId, text);
  await saveUser(user).catch(() => {});
  if (res.state !== 'ok') {
    console.error(`[reply-review] ${res.state}: ${res.detail}`);
    return { statusCode: 502, body: res.state === 'api-pending'
      ? 'Business Profile API access is still pending Google approval.'
      : 'Could not post the reply - please try again.' };
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
