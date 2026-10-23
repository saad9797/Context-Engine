// Public, read-only smoke checks. Run after syncing the Render rewrite and deploy.
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
function argument(name) { return args[args.indexOf(name) + 1]; }
function origin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Use an origin without credentials, paths or query strings.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Use HTTPS for deployed services.');
  return url.origin;
}
if (!args.includes('--frontend') || !args.includes('--api')) {
  console.error('Usage: node scripts/check-deployment.mjs --frontend https://your-site --api https://your-api');
  process.exit(2);
}
const frontend = origin(argument('--frontend'));
const api = origin(argument('--api'));
const checks = [];
async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
}
async function check(name, action) {
  try { checks.push({ name, ...await action() }); }
  catch (error) { checks.push({ name, passed: false, error: error.name === 'TimeoutError' ? 'timeout' : error.message }); }
}
const root = await fetchWithTimeout(frontend);
const html = await root.text();
const digest = text => createHash('sha256').update(text).digest('hex');
checks.push({ name: 'frontend_root', status: root.status, passed: root.ok && /<div[^>]+id="root"/.test(html) });
const paths = ['/dashboard', '/login', '/register', '/connections', '/settings', '/audit-log', '/ingest/new',
  '/contexts/00000000-0000-0000-0000-000000000000',
  '/contexts/00000000-0000-0000-0000-000000000000/claude-context',
  '/ingest/00000000-0000-0000-0000-000000000000/progress'];
await Promise.all(paths.map(path => check(`direct_load:${path}`, async () => {
  const response = await fetchWithTimeout(frontend + path);
  return { status: response.status, passed: response.ok && digest(await response.text()) === digest(html) };
})));
const script = html.match(/<script[^>]+src="([^"]+)"/);
if (script) await check('compiled_javascript', async () => {
  const url = new URL(script[1], frontend);
  if (url.origin !== frontend) throw Error('Unexpected external application script');
  const response = await fetchWithTimeout(url);
  return { status: response.status, passed: response.ok && /javascript/.test(response.headers.get('content-type') || '') };
});
await Promise.all(['/healthz', '/readyz'].map(path => check(`api:${path}`, async () => {
  const response = await fetchWithTimeout(api + path);
  const data = await response.json();
  return { status: response.status, passed: response.ok && data.status === 'ok', ...(data.checks ? { dependencies: data.checks } : {}) };
})));
await check('protected_api_requires_authentication', async () => {
  const response = await fetchWithTimeout(api + '/api/ingestion/');
  return { status: response.status, passed: [401, 403].includes(response.status) };
});
await check('production_cors', async () => {
  const response = await fetchWithTimeout(api + '/api/auth/login/', { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } });
  return { status: response.status, passed: response.ok && response.headers.get('access-control-allow-origin') === frontend };
});
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ frontend, api, passed, checks }, null, 2));
process.exitCode = passed ? 0 : 1;
