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
} catch {
  // no .env file present, continue
}

const PORT = 8000;
const {
  DNSDIST_URL,
  DNSDIST_API_KEY,
  PRIMARY_THRESHOLD = '10',
  IS_DEV,
  PIHOLE1_HREF = '#',
  PIHOLE2_HREF = '#',
  REFRESH_INTERVAL = '10000',
} = process.env;

const primaryThreshold = parseInt(PRIMARY_THRESHOLD, 10);

if (IS_DEV !== 'true') {
  const missing = ['DNSDIST_URL', 'DNSDIST_API_KEY'].filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }
}

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

  const { servers, statistics, pools, version } = json;

  const mapped = servers.map(({ name, address, state, queries, responses, order, qps, latency, healthCheckFailures }) => ({
    name,
    address,
    state,
    queries,
    responses,
    order,
    qps,
    latency,
    healthCheckFailures,
  }));

  const dnsPool = pools.find(p => p.name === 'dns') ?? {};

  return {
    version,
    statistics: {
      cacheHits: statistics['cache-hits'],
      cacheMisses: statistics['cache-misses'],
      uptime: statistics['uptime'],
      latencyAvg100: statistics['latency-avg100'],
    },
    pool: {
      cacheEntries: dnsPool.cacheEntries,
      cacheHits: dnsPool.cacheHits,
      cacheMisses: dnsPool.cacheMisses,
      cacheSize: dnsPool.cacheSize,
    },
    primaries: mapped.filter(s => s.order < primaryThreshold),
    fallbacks: mapped.filter(s => s.order >= primaryThreshold),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/data') {
    let primaries = null;
    let fallbacks = null;
    try {
      const data = await fetchDnsDistData();
      primaries = data.primaries;
      fallbacks = data.fallbacks;
    } catch (err) {
      console.error(err);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      primaries,
      fallbacks,
      pihole1Href: PIHOLE1_HREF,
      pihole2Href: PIHOLE2_HREF,
      refreshInterval: parseInt(REFRESH_INTERVAL, 10),
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
