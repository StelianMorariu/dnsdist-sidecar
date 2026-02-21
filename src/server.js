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
const { DNSDIST_URL, DNSDIST_API_KEY, PRIMARY_THRESHOLD = '10', IS_DEV } = process.env;

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
    const response = await fetch(`${DNSDIST_URL}/api/v1/servers/localhost`, {
      headers: { 'X-API-Key': DNSDIST_API_KEY },
    });

    if (!response.ok) {
      throw new Error(`dnsdist API responded ${response.status} ${response.statusText}`);
    }

    json = await response.json();
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

function renderTemplate(data) {
  // TODO: render HTML template
  console.log('Template data:', JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    try {
      const data = await fetchDnsDistData();
      renderTemplate(data);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
