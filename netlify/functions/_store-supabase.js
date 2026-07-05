// Supabase (Postgres) storage backend. Replaces the one-JSON-blob-per-user
// model with four normalized tables (users, connected_accounts, ad_accounts,
// selected_metrics - see supabase-schema.sql at the repo root), while
// assembling and accepting the exact same nested user object the rest of
// the functions have always used:
//
//   { id, email, passwordHash, createdAt,
//     accounts: { meta: { accessToken, adAccounts: [{id, name}],
//                         selectedAdAccountId, connectedAt,
//                         selectedMetrics: [{id, label}] },
//                 google: { ...same, plus refreshToken } } }
//
// Connects with the service/secret key (SUPABASE_SECRET_KEY), which
// bypasses RLS - the tables themselves are RLS-locked against the public
// anon key.
const { createClient } = require('@supabase/supabase-js');
const { hashPassword } = require('./_password');

const PROVIDERS = ['meta', 'google'];

let client;
function db() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false }
    });
  }
  return client;
}

function fail(error, doing) {
  throw new Error(`Database error while ${doing}: ${error.message}`);
}

function byPosition(a, b) {
  return a.position - b.position;
}

// One connected_accounts row (with its embedded child rows) back into the
// provider object shape the rest of the code expects.
function assembleProvider(row) {
  const provider = {
    accessToken: row.access_token,
    adAccounts: (row.ad_accounts || [])
      .sort(byPosition)
      .map((a) => ({ id: a.external_id, name: a.name })),
    selectedAdAccountId: row.selected_ad_account_id,
    connectedAt: row.connected_at
  };
  if (row.refresh_token) provider.refreshToken = row.refresh_token;
  const metrics = (row.selected_metrics || [])
    .sort(byPosition)
    .map((m) => ({ id: m.metric_id, label: m.label }));
  if (metrics.length) provider.selectedMetrics = metrics;
  return provider;
}

async function getUser(email) {
  const { data: u, error } = await db()
    .from('users')
    .select('id, email, password_hash, created_at')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) fail(error, 'loading user');
  if (!u) return null;

  const { data: accounts, error: accError } = await db()
    .from('connected_accounts')
    .select(
      'id, provider, access_token, refresh_token, selected_ad_account_id, connected_at, ' +
        'ad_accounts ( external_id, name, position ), ' +
        'selected_metrics ( metric_id, label, position )'
    )
    .eq('user_id', u.id);
  if (accError) fail(accError, 'loading connected accounts');

  const user = {
    id: u.id,
    email: u.email,
    passwordHash: u.password_hash,
    createdAt: u.created_at,
    accounts: {}
  };
  (accounts || []).forEach((row) => {
    user.accounts[row.provider] = assembleProvider(row);
  });
  return user;
}

async function createUser(email, password) {
  const { data, error } = await db()
    .from('users')
    .insert({ email: email.toLowerCase(), password_hash: hashPassword(password) })
    .select('id, email, password_hash, created_at')
    .single();
  if (error) {
    // 23505 = Postgres unique violation; same message the Blobs backend threw.
    if (error.code === '23505') throw new Error('An account with that email already exists.');
    fail(error, 'creating user');
  }
  return {
    id: data.id,
    email: data.email,
    passwordHash: data.password_hash,
    createdAt: data.created_at,
    accounts: {}
  };
}

// Persists the (mutated) user object. Provider rows are upserted and their
// child rows replaced wholesale, which reproduces the Blobs semantics
// exactly - e.g. reconnecting Meta replaces the whole provider object,
// clearing any previous metric selection.
async function saveUser(user) {
  let userId = user.id;
  if (!userId) {
    const { data: u, error } = await db()
      .from('users')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();
    if (error) fail(error, 'looking up user');
    if (!u) throw new Error('User not found.');
    userId = u.id;
  }

  for (const provider of PROVIDERS) {
    const acc = user.accounts && user.accounts[provider];

    if (!acc) {
      const { error } = await db()
        .from('connected_accounts')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider);
      if (error) fail(error, `removing ${provider} connection`);
      continue;
    }

    const { data: row, error: upsertError } = await db()
      .from('connected_accounts')
      .upsert(
        {
          user_id: userId,
          provider,
          access_token: acc.accessToken || null,
          refresh_token: acc.refreshToken || null,
          selected_ad_account_id: acc.selectedAdAccountId || null,
          connected_at: acc.connectedAt || null
        },
        { onConflict: 'user_id,provider' }
      )
      .select('id')
      .single();
    if (upsertError) fail(upsertError, `saving ${provider} connection`);

    const { error: delAdsError } = await db()
      .from('ad_accounts')
      .delete()
      .eq('connected_account_id', row.id);
    if (delAdsError) fail(delAdsError, `clearing ${provider} ad accounts`);

    if (acc.adAccounts && acc.adAccounts.length) {
      const { error } = await db()
        .from('ad_accounts')
        .insert(
          acc.adAccounts.map((a, i) => ({
            connected_account_id: row.id,
            external_id: a.id,
            name: a.name,
            position: i
          }))
        );
      if (error) fail(error, `saving ${provider} ad accounts`);
    }

    const { error: delMetricsError } = await db()
      .from('selected_metrics')
      .delete()
      .eq('connected_account_id', row.id);
    if (delMetricsError) fail(delMetricsError, `clearing ${provider} metrics`);

    if (acc.selectedMetrics && acc.selectedMetrics.length) {
      const { error } = await db()
        .from('selected_metrics')
        .insert(
          acc.selectedMetrics.map((m, i) => ({
            connected_account_id: row.id,
            metric_id: m.id,
            label: m.label,
            position: i
          }))
        );
      if (error) fail(error, `saving ${provider} metrics`);
    }
  }
}

module.exports = { getUser, createUser, saveUser };
