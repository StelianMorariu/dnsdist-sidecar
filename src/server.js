import http from 'http';
import { readFileSync } from 'fs';

// Load .env from project root into process.env (values already in the environment take precedence)
try {
  const envContent = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
  console.log('.env loaded');
} catch {
  console.log('No .env file found, using environment variables');
}

const PORT = 8000;
const {
  DNSDIST_URL,
  DNSDIST_API_KEY,
  PRIMARY_THRESHOLD = '10',
  IS_DEV,
  PIHOLE1_HREF = '#',
  PIHOLE2_HREF = '#',
  REFRESH_INTERVAL = '20000',
} = process.env;

const primaryThreshold = parseInt(PRIMARY_THRESHOLD, 10);
const refreshInterval = parseInt(REFRESH_INTERVAL, 10);

// Cached at startup — index.html is static and does not change at runtime
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

let lastHealthStatus = 'unreachable';

if (IS_DEV !== 'true') {
  const missing = ['DNSDIST_URL', 'DNSDIST_API_KEY'].filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }
}

const VALID_LAYOUTS = ['auto', 'detail', 'compact'];
const DEFAULT_CONFIG = {
  layout: 'auto',
  primaryServerIcon: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/pi-hole-unbound.webp',
  secondaryServerIcon: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/webp/pi-hole-unbound.webp',
  failoverServerIcon: 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/cloudflare.svg',
};

// Read config.json on every call so changes take effect on the next page refresh
// without requiring a container restart. Falls back to defaults if the file is
// missing, unreadable, or contains unrecognised values.
function readConfig() {
  try {
    const raw = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
    return {
      layout: VALID_LAYOUTS.includes(raw.layout) ? raw.layout : DEFAULT_CONFIG.layout,
      primaryServerIcon: raw.primaryServerIcon || DEFAULT_CONFIG.primaryServerIcon,
      secondaryServerIcon: raw.secondaryServerIcon || DEFAULT_CONFIG.secondaryServerIcon,
      failoverServerIcon: raw.failoverServerIcon || DEFAULT_CONFIG.failoverServerIcon,
    };
  } catch {}
  return DEFAULT_CONFIG;
}

// Fetches server data from the dnsdist REST API (or dev-data.json in IS_DEV mode).
// Returns only the fields the client actually needs — primaries and fallbacks —
// split by PRIMARY_THRESHOLD.
async function fetchDnsDistData() {
  let json;

  if (IS_DEV === 'true') {
    const raw = readFileSync(new URL('../dev-data.json', import.meta.url), 'utf8');
    json = JSON.parse(raw);
  } else {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${DNSDIST_URL}/api/v1/servers/localhost`, {
        headers: { 'X-API-Key': DNSDIST_API_KEY },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`dnsdist API responded ${response.status} ${response.statusText}`);
      }
      json = await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const mapped = json.servers.map(({ name, address, state, queries, responses, order }) => ({
    name,
    address,
    state,
    queries,
    responses,
    order,
  }));

  return {
    primaries: mapped.filter(s => s.order < primaryThreshold),
    fallbacks: mapped.filter(s => s.order >= primaryThreshold),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serve the single-page UI
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Data endpoint — polled by the client on each refresh interval.
  // Also re-reads config.json so layout changes are picked up without a restart.
  if (req.method === 'GET' && url.pathname === '/data') {
    let primaries = null;
    let fallbacks = null;
    try {
      const data = await fetchDnsDistData();
      primaries = data.primaries;
      fallbacks = data.fallbacks;
      lastHealthStatus = 'healthy';
      console.log('dnsdist fetch OK');
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timed out' : err.message;
      console.log('dnsdist fetch failed: ' + reason);
      lastHealthStatus = 'unreachable';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      primaries,
      fallbacks,
      pihole1Href: PIHOLE1_HREF,
      pihole2Href: PIHOLE2_HREF,
      refreshInterval,
      ...readConfig(),
    }));
    return;
  }

  // Health check — used by Docker HEALTHCHECK and Homepage widget monitoring.
  // Returns 200 if the last dnsdist fetch succeeded, 503 otherwise.
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(lastHealthStatus === 'healthy' ? 200 : 503);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.on('error', (err) => {
  console.error('Server error: ' + err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
  console.log(`Mode: ${IS_DEV === 'true' ? 'development' : 'production'}`);
});
