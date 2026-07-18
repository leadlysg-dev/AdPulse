// Server-side demo write protection. The demo client never calls mutating
// endpoints at all (its request adapter blocks them before fetch), but any
// request that identifies itself as demo - the x-leadly-demo header or a
// demo:true body flag - is refused here too, rather than trusting the
// client to hold back.
const DEMO_MESSAGE = 'This is a demo — sign up to make changes.';

function demoGuard(event) {
  const headers = event.headers || {};
  let flagged = headers['x-leadly-demo'] === '1';
  if (!flagged && event.body) {
    try {
      flagged = JSON.parse(event.body).demo === true;
    } catch {
      // not JSON - nothing to flag
    }
  }
  if (!flagged) return null;
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: DEMO_MESSAGE })
  };
}

module.exports = { demoGuard, DEMO_MESSAGE };
