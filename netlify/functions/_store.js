// Handles customer accounts (email + password), login sessions, and each
// customer's connected ad accounts. Everything is keyed by email, so a
// customer sees the same data no matter which device or browser they log in
// from - and can never see another customer's data.
//
// Storage lives in Supabase Postgres (_store-supabase.js). The original
// Netlify Blobs backend (_store-blobs.js) is kept as a fallback: set
// STORAGE_BACKEND=blobs in Netlify's environment variables to switch back
// without touching code. Sessions are stateless JWTs and never touch
// storage, so they work identically on both backends.
const jwt = require('jsonwebtoken');
const { verifyPassword } = require('./_password');

const backend =
  process.env.STORAGE_BACKEND === 'blobs'
    ? require('./_store-blobs')
    : require('./_store-supabase');

// --- Sessions (JWT stored in an httpOnly cookie) ---
function createSessionCookie(email) {
  const token = jwt.sign({ email }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  return `adpulse_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function clearSessionCookie() {
  return 'adpulse_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function getEmailFromRequest(headers) {
  const cookie = headers.cookie || '';
  const match = cookie.match(/adpulse_session=([^;]+)/);
  if (!match) return null;
  try {
    const payload = jwt.verify(match[1], process.env.SESSION_SECRET);
    return payload.email;
  } catch {
    return null; // expired or tampered token
  }
}

// Whether this user ever set a password themselves. Accounts auto-created by
// Google sign-in carry passwordSetAt: null; records predating the field
// (undefined) are treated as set, matching the migration's backfill.
function hasSetPassword(user) {
  return user.passwordSetAt !== null;
}

// --- Workspace resolution (multi-tenant) ---
// The active workspace rides in its own cookie; it must always be validated
// against the user's memberships, so a stale or forged cookie can never
// reach another tenant's data. No memberships (migration 011 not run yet)
// degrades to the legacy single-tenant behaviour.
function workspaceCookie(id) {
  return `leadly_ws=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

async function getWorkspaceFromRequest(headers, email) {
  let memberships = [];
  try {
    memberships = await backend.listMemberships(email);
  } catch (err) {
    console.error(`[store] memberships unavailable (run migration 011?): ${err.message}`);
  }
  const match = ((headers && headers.cookie) || '').match(/leadly_ws=([^;]+)/);
  const wanted = match ? decodeURIComponent(match[1]) : null;

  // Platform admins may enter workspaces they aren't members of ("Enter
  // workspace" from the admin directory). The cookie alone never grants
  // this - the platform_admin row does; everyone else falls back to their
  // own memberships below.
  if (wanted && !memberships.some((m) => m.id === wanted)) {
    try {
      if (await backend.isPlatformAdmin(email)) {
        const ws = await backend.getWorkspaceById(wanted);
        if (ws) return { ...ws, role: 'agency', adminView: true, memberships };
      }
    } catch (err) {
      console.error(`[store] admin workspace lookup failed: ${err.message}`);
    }
  }

  if (!memberships.length) {
    return { id: null, role: 'owner', name: 'Leadly (Agency)', billingExempt: false, memberships: [] };
  }
  const active = memberships.find((m) => m.id === wanted) || memberships[0];
  return { ...active, memberships };
}

// The user object whose ad connections this request should read: clients,
// Leadly teammates (agency role), and admins viewing a workspace all see it
// through the OWNER's connections - only the owner ever OAuths.
async function getDataUser(email, workspace) {
  const throughOwner =
    workspace && workspace.id && (workspace.role === 'client' || workspace.role === 'member' || workspace.role === 'agency' || workspace.adminView);
  if (throughOwner) {
    const ownerEmail = await backend.workspaceOwnerEmail(workspace.id);
    if (ownerEmail && ownerEmail !== email) {
      const owner = await backend.getUser(ownerEmail);
      if (owner) return owner;
    }
  }
  return backend.getUser(email);
}

module.exports = {
  getUser: backend.getUser,
  createUser: backend.createUser,
  saveUser: backend.saveUser,
  setPassword: backend.setPassword,
  saveAiPrefs: backend.saveAiPrefs,
  getAiInsightCache: backend.getAiInsightCache,
  saveAiInsightCache: backend.saveAiInsightCache,
  clearAiInsightCache: backend.clearAiInsightCache,
  createChangeLog: backend.createChangeLog,
  listChangeLog: backend.listChangeLog,
  getStudioRecord: backend.getStudioRecord,
  putStudioRecord: backend.putStudioRecord,
  listStudioRecords: backend.listStudioRecords,
  listAlertRules: backend.listAlertRules,
  createAlertRule: backend.createAlertRule,
  updateAlertRule: backend.updateAlertRule,
  deleteAlertRule: backend.deleteAlertRule,
  listMemberships: backend.listMemberships,
  getMetricsConfig: backend.getMetricsConfig,
  saveMetricsConfig: backend.saveMetricsConfig,
  workspaceOwnerEmail: backend.workspaceOwnerEmail,
  isPlatformAdmin: backend.isPlatformAdmin,
  getPlatformSetting: backend.getPlatformSetting,
  savePlatformSetting: backend.savePlatformSetting,
  getWorkspaceStudio: backend.getWorkspaceStudio,
  setWorkspaceStudio: backend.setWorkspaceStudio,
  addStudioSpend: backend.addStudioSpend,
  getMonthSpend: backend.getMonthSpend,
  getMonthSpendAll: backend.getMonthSpendAll,
  createStudioJob: backend.createStudioJob,
  getStudioJobById: backend.getStudioJobById,
  updateStudioJob: backend.updateStudioJob,
  listStudioJobs: backend.listStudioJobs,
  getWorkspaceById: backend.getWorkspaceById,
  listAllWorkspaces: backend.listAllWorkspaces,
  createWorkspace: backend.createWorkspace,
  createAdminSession: backend.createAdminSession,
  endAdminSessions: backend.endAdminSessions,
  writeAudit: backend.writeAudit,
  listWorkspaceMembers: backend.listWorkspaceMembers,
  addWorkspaceMember: backend.addWorkspaceMember,
  removeWorkspaceMember: backend.removeWorkspaceMember,
  getWorkspaceInvite: backend.getWorkspaceInvite,
  createWorkspaceInvite: backend.createWorkspaceInvite,
  acceptWorkspaceInvite: backend.acceptWorkspaceInvite,
  createChangeRequest: backend.createChangeRequest,
  listChangeRequests: backend.listChangeRequests,
  getWorkspaceFromRequest,
  getDataUser,
  workspaceCookie,
  hasSetPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  getEmailFromRequest
};
