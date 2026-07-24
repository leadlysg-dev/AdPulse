// Shared demo-mode strings. Kept dependency-free so the shell can import
// them without pulling the fixture data into the main bundle.
export const DEMO_MESSAGE = 'This is a demo — sign up to make changes.';

// Fired by the demo request adapter whenever a write is blocked; the shell
// listens (only in demo) and shows its normal toast, which covers callers
// that swallow request errors silently.
export const DEMO_BLOCKED_EVENT = 'leadly:demo-blocked';
