const KEY = 'contexa-login-return';
const protectedPath = /^\/(?:dashboard|connections|audit-log|settings|ingest\/new|ingest\/[^/]+\/progress|contexts\/[^/]+(?:\/claude-context)?)\/?$/;

export function safeReturnPath(value) {
  const path = typeof value === 'string' ? value : value?.pathname && `${value.pathname}${value.search || ''}`;
  if (!path || !path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x1f]/.test(path)) return null;
  try {
    const url = new URL(path, 'https://contexa.invalid');
    if (url.origin !== 'https://contexa.invalid' || !protectedPath.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}

export function rememberReturnPath(value) {
  const path = safeReturnPath(value);
  try { if (path) sessionStorage.setItem(KEY, path); } catch { /* optional storage */ }
}

export function takeReturnPath(value) {
  let stored;
  try { stored = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { /* optional storage */ }
  return safeReturnPath(value) || safeReturnPath(stored) || '/dashboard';
}
