#!/usr/bin/env node
// TrueCap — a market-cap aggregator that lists Bitcoin BLAKE2b (XBT) with its
// full on-chain supply alongside the top coins from CoinGecko.
//
//   node server.js            start the site (http://localhost:8080)
//   node server.js --check    test every data source once and print what it got
//   MOCK=1 node server.js     run offline with bundled demo data

const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveSupply } = require('./lib/supply');
const { fetchMarket, aggregate } = require('./lib/markets');

const ROOT = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const MOCK = process.env.MOCK === '1';
const PORT = Number(process.env.PORT || config.port || 8080);
// Where price history and the cached logo are kept. On a cloud host, point
// DATA_DIR at a persistent disk so history survives restarts and updates.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, MOCK ? 'history-mock.json' : 'history.json');
const SITE = config.siteName || 'TrueCap';
if (process.env.COINGECKO_API_KEY) config.coingecko.apiKey = process.env.COINGECKO_API_KEY;

// ---------- fetch (real or mock) ----------
const fetchImpl = MOCK ? require('./lib/mockfetch')(path.join(ROOT, 'fixtures')) : globalThis.fetch;

// CoinGecko has two kinds of key: free "Demo" keys (api.coingecko.com) and paid
// keys (pro-api.coingecko.com). At startup we try the key on the paid address;
// if CoinGecko accepts it there we use that, otherwise the free address.
let cgKeyType = null; // 'paid' | 'demo' | null (no key)
async function detectCoinGeckoPlan() {
  const key = config.coingecko.apiKey;
  if (!key || MOCK) return;
  try {
    const r = await fetchImpl(`${config.coingecko.proBase}/ping`, { headers: { 'x-cg-pro-api-key': key } });
    if (r.ok) { cgKeyType = 'paid'; config.coingecko.base = config.coingecko.proBase; }
    else cgKeyType = 'demo';
  } catch (e) {
    cgKeyType = 'demo';
    console.log('Could not check the CoinGecko key type (' + e.message + '); using the free Demo address.');
  }
  console.log(`CoinGecko key: ${cgKeyType === 'paid' ? 'paid plan (pro-api.coingecko.com)' : 'Demo (api.coingecko.com)'}`);
}

async function getJson(url) {
  const headers = { accept: 'application/json' };
  if (config.coingecko.apiKey && url.startsWith(config.coingecko.base)) {
    headers[cgKeyType === 'paid' ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'] = config.coingecko.apiKey;
  }
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// ---------- history ----------
let history = [];
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { history = []; }
if (MOCK && !history.length) { // demo: 8 days of synthetic hourly XBT prices
  let p = 268, seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let h = 8 * 24; h > 0; h--) { p *= 1 + (rnd() - 0.47) * 0.03; history.push({ t: Date.now() - h * 36e5, price: p, cap: p * 20.1e6 }); }
  const k = 305.4 / p; history.forEach((x) => { x.price *= k; x.cap *= k; });
}

function recordHistory(point) {
  history.push(point);
  pruneAndSave();
}

function pruneAndSave() {
  history.sort((a, b) => a.t - b.t);
  const now = Date.now();
  const cutoff = now - 35 * 864e5;
  const out = [];
  let lastHourKept = -1;
  for (const p of history) {
    if (p.t < cutoff) continue;
    if (now - p.t > 48 * 36e5) { // older than 48h: one point per hour
      const hr = Math.floor(p.t / 36e5);
      if (hr === lastHourKept) continue;
      lastHourKept = hr;
    }
    out.push(p);
  }
  history = out;
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
}

// Fill gaps in our own price history with Neoxa's candle (chart) data, so 1h/7d
// changes and the chart work right away and after the program was closed.
let lastSupply = null;
async function backfillHistory() {
  const h = config.xbt.history;
  if (!h || !h.sources || MOCK) return;
  let added = 0;
  for (const src of h.sources) {
    try {
      const j = await getJson(src.url);
      const candles = j.candles || j.data || (Array.isArray(j) ? j : []);
      const tol = (src.intervalSeconds * 1000) / 2;
      const now = Date.now();
      for (const k of candles) {
        const t = Math.min(now, (Number(k.time) + src.intervalSeconds) * 1000); // candle close time
        const price = Number(k.close);
        if (!(price > 0) || now - t > 35 * 864e5) continue;
        if (history.some((p) => Math.abs(p.t - t) < tol)) continue;
        history.push({ t, price, cap: lastSupply ? price * lastSupply : undefined, src: 'neoxa' });
        added++;
      }
    } catch (e) {
      console.log('history backfill failed for ' + src.url + ': ' + e.message);
    }
  }
  if (added) { pruneAndSave(); console.log(`Filled in ${added} past XBT prices from Neoxa.`); }
}

function priceAgo(ms) {
  // Price closest to `ms` ago, from either side. Exchanges skip periods with no
  // trades, so allow a small gap (15 min, or 10% of the window if larger).
  const target = Date.now() - ms;
  const tol = Math.max(ms * 0.1, 15 * 60e3);
  let best = null;
  for (const p of history) {
    if (!best || Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
  }
  return best && Math.abs(best.t - target) <= tol ? best.price : null;
}

// ---------- refresh ----------
let snapshot = { status: 'starting', updatedAt: null, mock: MOCK };

async function buildXbt(quoteUsd) {
  const x = config.xbt;
  const symbols = [x.symbol, ...(x.aliases || [])];
  const results = await Promise.allSettled(x.markets.map((m) => fetchMarket(m, fetchImpl, symbols)));
  const rows = [];
  const sourceStatus = [];
  results.forEach((r, i) => {
    const m = x.markets[i];
    if (r.status === 'fulfilled') { rows.push(...r.value); sourceStatus.push({ exchange: m.exchange, ok: true, pairs: r.value.length }); }
    else sourceStatus.push({ exchange: m.exchange, ok: false, error: String(r.reason && r.reason.message || r.reason) });
  });

  const agg = aggregate(rows, quoteUsd, x.outlierPct);
  const supply = await resolveSupply(x, fetchImpl);
  lastSupply = supply.supply;
  const capSupply = x.marketCapSupply === 'max' ? x.maxSupply : supply.supply;
  const price = agg.price;

  const p1h = priceAgo(36e5), p24 = priceAgo(864e5), p7d = priceAgo(7 * 864e5);
  const pct = (old) => (old && price ? (price / old - 1) * 100 : null);

  const now = Date.now();
  const spark = history.filter((p) => p.t >= now - 7 * 864e5).map((p) => p.price);

  return {
    coin: {
      id: x.id, symbol: x.symbol.toLowerCase(), name: x.name, image: x.logoUrl ? '/xbt-logo.png' : null, isXbt: true,
      current_price: price,
      market_cap: price != null ? price * capSupply : null,
      fully_diluted_valuation: price != null ? price * x.maxSupply : null,
      total_volume: agg.volume,
      circulating_supply: supply.supply,
      total_supply: supply.supply,
      max_supply: x.maxSupply,
      price_change_percentage_1h_in_currency: pct(p1h),
      price_change_percentage_24h_in_currency: pct(p24) ?? agg.change24hFromExchanges,
      price_change_percentage_7d_in_currency: pct(p7d),
      sparkline_in_7d: { price: spark },
    },
    detail: {
      supply: { ...supply, maxSupply: x.maxSupply, marketCapSupply: x.marketCapSupply,
        pctMined: (supply.supply / x.maxSupply) * 100, forkHeight: x.forkHeight,
        blake2bActivationHeight: x.blake2bActivationHeight },
      markets: agg.markets,
      sources: sourceStatus,
      quoteUsd,
      outlierPct: x.outlierPct,
    },
  };
}

async function refresh() {
  const cg = config.coingecko.base;
  const vs = config.vsCurrency;
  const pages = Math.ceil(config.topCoins / 250);
  const marketReqs = [];
  for (let p = 1; p <= pages; p++) {
    marketReqs.push(getJson(`${cg}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${Math.min(250, config.topCoins)}&page=${p}&sparkline=true&price_change_percentage=1h,24h,7d`));
  }
  const quoteIds = [...new Set(Object.values(config.xbt.quotePricing).filter((v) => !v.startsWith('$')))];
  const [marketsPages, global, simple] = await Promise.all([
    Promise.all(marketReqs),
    // Market-wide totals and quote-currency prices change slowly: refresh every 10 min to save API credits.
    cached('cg:global', 10 * 60e3, () => getJson(`${cg}/global`)).catch(() => null),
    cached('cg:simple', 10 * 60e3, () => getJson(`${cg}/simple/price?ids=${quoteIds.join(',')}&vs_currencies=${vs}`)).catch(() => ({})),
  ]);
  let coins = marketsPages.flat().filter((c) => c.id !== config.xbt.id);
  // Display-name changes from config.json, e.g. Bitcoin -> Bitcoin SHA-256
  const renames = config.nameOverrides || {};
  coins.forEach((c) => { if (renames[c.id]) c.name = renames[c.id]; });

  const quoteUsd = {};
  for (const [sym, src] of Object.entries(config.xbt.quotePricing)) {
    if (src.startsWith('$')) quoteUsd[sym] = Number(src.slice(1));
    else if (simple[src] && simple[src][vs]) quoteUsd[sym] = simple[src][vs];
    else { const c = coins.find((k) => k.id === src); if (c) quoteUsd[sym] = c.current_price; }
  }

  const xbt = await buildXbt(quoteUsd);
  if (xbt.coin.current_price != null) {
    recordHistory({ t: Date.now(), price: xbt.coin.current_price, cap: xbt.coin.market_cap, volume: xbt.coin.total_volume, height: xbt.detail.supply.height });
  }

  coins.push(xbt.coin);
  coins.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
  // Keep exactly `topCoins` entries, always including XBT.
  coins = coins.slice(0, config.topCoins);
  if (!coins.includes(xbt.coin)) coins[coins.length - 1] = xbt.coin;
  coins.forEach((c, i) => { c.rank = i + 1; });

  // Global stats, with XBT added on top of CoinGecko's totals.
  const g = global && global.data;
  const xbtCap = xbt.coin.market_cap || 0;
  const totalCap = (g ? g.total_market_cap[vs] : coins.reduce((s, c) => s + (c.market_cap || 0), 0)) + xbtCap;
  const totalVol = (g ? g.total_volume[vs] : coins.reduce((s, c) => s + (c.total_volume || 0), 0)) + (xbt.coin.total_volume || 0);
  const btc = coins.find((c) => c.id === 'bitcoin');
  const eth = coins.find((c) => c.id === 'ethereum');

  snapshot = {
    status: 'ok', mock: MOCK, siteName: SITE, updatedAt: new Date().toISOString(), vs,
    global: {
      totalMarketCap: totalCap, totalVolume: totalVol,
      btcDominance: btc ? (btc.market_cap / totalCap) * 100 : null,
      ethDominance: eth ? (eth.market_cap / totalCap) * 100 : null,
      xbtDominance: (xbtCap / totalCap) * 100,
      activeCryptos: g ? g.active_cryptocurrencies + 1 : coins.length,
      cgChange24h: g ? g.market_cap_change_percentage_24h_usd : null,
    },
    coins,
    xbt: { ...xbt.detail, rank: xbt.coin.rank, coin: xbt.coin },
  };
  console.log(`[${new Date().toISOString()}] refreshed: ${coins.length} coins, XBT $${xbt.coin.current_price?.toFixed(2)} rank #${xbt.coin.rank}, supply ${xbt.detail.supply.supply.toLocaleString()} (${xbt.detail.supply.method})`);
}

async function loop() {
  try { await refresh(); }
  catch (e) {
    console.error('refresh failed:', e.message);
    if (snapshot.status !== 'ok') snapshot = { ...snapshot, status: 'error', error: e.message };
    else snapshot.lastError = e.message;
  }
  setTimeout(loop, config.refreshSeconds * 1000);
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// ---------- per-coin detail (fetched from CoinGecko only when a coin page is opened) ----------
const cache = new Map(); // key -> { at, ttl, data }
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data; // CoinGecko busy: fall back to the last copy we had
    throw e;
  }
}

async function coinDetail(id) {
  const cg = config.coingecko.base;
  return cached('coin:' + id, 10 * 60e3, async () => {
    const d = await getJson(`${cg}/coins/${encodeURIComponent(id)}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false&sparkline=false`);
    const md = d.market_data || {};
    const vs = config.vsCurrency;
    const tickers = (d.tickers || [])
      .filter((t) => !t.is_stale && !t.is_anomaly && t.converted_last && t.converted_volume)
      .map((t) => ({
        exchange: t.market && t.market.name, pair: `${t.base}/${t.target}`,
        priceUsd: t.converted_last.usd, volumeUsd: t.converted_volume.usd,
        trust: t.trust_score, url: t.trade_url,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, 25);
    return {
      id: d.id, name: (config.nameOverrides || {})[d.id] || d.name, symbol: d.symbol,
      description: ((d.description && d.description.en) || '').replace(/<[^>]+>/g, '').trim(),
      homepage: ((d.links && d.links.homepage) || []).filter(Boolean)[0] || null,
      explorers: ((d.links && d.links.blockchain_site) || []).filter(Boolean).slice(0, 3),
      categories: (d.categories || []).filter(Boolean).slice(0, 4),
      genesis: d.genesis_date || null,
      ath: md.ath && md.ath[vs], athDate: md.ath_date && md.ath_date[vs], athChange: md.ath_change_percentage && md.ath_change_percentage[vs],
      atl: md.atl && md.atl[vs], atlDate: md.atl_date && md.atl_date[vs], atlChange: md.atl_change_percentage && md.atl_change_percentage[vs],
      high24: md.high_24h && md.high_24h[vs], low24: md.low_24h && md.low_24h[vs],
      change30d: md.price_change_percentage_30d, change1y: md.price_change_percentage_1y,
      tickers,
    };
  });
}

async function coinChart(id, days) {
  const cg = config.coingecko.base;
  return cached(`chart:${id}:${days}`, days <= 1 ? 5 * 60e3 : 15 * 60e3, async () => {
    const d = await getJson(`${cg}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${config.vsCurrency}&days=${days}`);
    const caps = d.market_caps || [];
    return (d.prices || []).map(([t, price], i) => ({ t, price, cap: caps[i] ? caps[i][1] : undefined }));
  });
}

// ---------- candles (OHLC) for the advanced chart ----------
async function xbtCandles(interval) {
  const tpl = config.xbt.candles && config.xbt.candles.urlTemplate;
  if (!tpl) throw new Error('no candle source configured');
  const src = interval === '4h' ? '1h' : interval; // Neoxa has no 4h: build it from 1h
  const raw = await cached('xcandles:' + src, src === '1d' ? 10 * 60e3 : 60e3, async () => {
    const j = await getJson(tpl.replace('{interval}', src).replace('{limit}', '1000'));
    return (j.candles || j.data || []).map((k) => ({
      t: Number(k.time) * 1000, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume || 0,
    })).filter((k) => k.c > 0).sort((a, b) => a.t - b.t);
  });
  if (interval !== '4h') return raw;
  const out = [];
  for (const k of raw) {
    const bucket = Math.floor(k.t / (4 * 36e5)) * 4 * 36e5;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, k.h); last.l = Math.min(last.l, k.l); last.c = k.c; last.v += k.v;
    } else out.push({ t: bucket, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v });
  }
  return out;
}

async function coinOhlc(id, days) {
  const cg = config.coingecko.base;
  return cached(`ohlc:${id}:${days}`, 10 * 60e3, async () => {
    const d = await getJson(`${cg}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=${config.vsCurrency}&days=${days}`);
    return (Array.isArray(d) ? d : []).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  });
}

async function apiCoin(res, id, sub, params) {
  try {
    if (sub === 'ohlc') {
      const days = [1, 7, 30, 90, 365].includes(Number(params.get('days'))) ? Number(params.get('days')) : 30;
      return send(res, 200, await coinOhlc(id, days));
    }
    if (sub === 'chart') {
      const days = [1, 7, 30, 365].includes(Number(params.get('days'))) ? Number(params.get('days')) : 7;
      return send(res, 200, await coinChart(id, days));
    }
    return send(res, 200, await coinDetail(id));
  } catch (e) {
    const busy = /^429/.test(e.message);
    return send(res, busy ? 429 : 502, { error: busy ? 'CoinGecko is busy. Try again in a minute.' : 'Could not load details: ' + e.message });
  }
}

// XBT logo: downloaded once from config.xbt.logoUrl (Neoxa) and kept in data/.
const LOGO_FILE = path.join(DATA_DIR, 'xbt-logo.png');
async function serveLogo(res) {
  try {
    if (!fs.existsSync(LOGO_FILE)) {
      if (MOCK) throw new Error('no logo in demo mode');
      const r = await fetch(config.xbt.logoUrl, { headers: { 'user-agent': 'Mozilla/5.0 (TrueCap)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.mkdirSync(path.dirname(LOGO_FILE), { recursive: true });
      fs.writeFileSync(LOGO_FILE, Buffer.from(await r.arrayBuffer()));
    }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
    res.end(fs.readFileSync(LOGO_FILE));
  } catch (e) {
    send(res, 404, 'logo unavailable: ' + e.message, 'text/plain');
  }
}

function serve() {
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/snapshot') return send(res, 200, snapshot);
    if (url.pathname === '/healthz') return send(res, snapshot.status === 'error' ? 503 : 200, { status: snapshot.status, updatedAt: snapshot.updatedAt });
    if (url.pathname === '/api/xbt') return send(res, 200, snapshot.xbt || {});
    if (url.pathname === '/api/xbt/history') {
      const days = Math.min(35, Number(url.searchParams.get('days') || 7));
      const since = Date.now() - days * 864e5;
      return send(res, 200, history.filter((p) => p.t >= since));
    }
    // Simple, CoinGecko-shaped endpoints so other tools can consume XBT data.
    if (url.pathname === '/xbt-logo.png') return serveLogo(res);
    if (url.pathname === '/api/xbt/candles') {
      const iv = ['5m', '15m', '1h', '4h', '1d'].includes(url.searchParams.get('interval')) ? url.searchParams.get('interval') : '1h';
      return xbtCandles(iv).then((d) => send(res, 200, d), (e) => send(res, 502, { error: 'Could not load XBT candles: ' + e.message }));
    }
    const cm = url.pathname.match(/^\/api\/coin\/([a-z0-9-]+)(?:\/(chart|ohlc))?$/);
    if (cm) return apiCoin(res, cm[1], cm[2], url.searchParams);
    if (url.pathname === '/api/v1/supply/xbt') return send(res, 200, String(snapshot.xbt?.supply?.supply ?? ''), 'text/plain');
    if (url.pathname === '/api/v1/coins/markets') return send(res, 200, snapshot.coins || []);

    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const fp = path.join(ROOT, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(path.join(ROOT, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      send(res, 200, buf, TYPES[path.extname(fp)] || 'application/octet-stream');
    });
  }).listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`${SITE} running at ${url}${MOCK ? '  (MOCK demo data)' : ''}`);
    console.log(`Keep this window open while you use the site. Close it to stop ${SITE}.`);
    if (process.env.OPEN === '1') {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      setTimeout(() => require('child_process').exec(cmd), 2500); // give the first data load a moment
    }
  }).on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.log(`\n${SITE} is already running. Open http://localhost:${PORT} in your browser.\n`);
    else console.log('Could not start: ' + e.message);
  });
}

// ---------- --check ----------
async function check() {
  const x = config.xbt;
  const symbols = [x.symbol, ...(x.aliases || [])];
  console.log('Checking data sources…\n');
  try { const m = await getJson(`${config.coingecko.base}/coins/markets?vs_currency=usd&per_page=5&page=1`); console.log(`✔ CoinGecko markets: ${m.map((c) => c.symbol).join(', ')}`); }
  catch (e) { console.log(`✘ CoinGecko: ${e.message}`); }
  for (const m of x.markets) {
    try {
      const rows = await fetchMarket(m, fetchImpl, symbols);
      if (!rows.length) console.log(`⚠ ${m.exchange}: reached ${m.endpoint} but none of ${m.pairs.join(', ')} were in the response`);
      for (const r of rows) console.log(`✔ ${m.exchange} ${r.pair}: last ${r.last}, 24h base vol ${r.baseVolume}`);
    } catch (e) { console.log(`✘ ${m.exchange}: ${e.message}  (${m.endpoint})`); }
  }
  try {
    const s = await resolveSupply(x, fetchImpl);
    console.log(`✔ Supply: ${s.supply.toLocaleString()} XBT at height ${s.height} via ${s.method}${s.exact ? '' : ' (ESTIMATE)'}`);
  } catch (e) { console.log(`✘ Supply: ${e.message}`); }
}

if (process.argv.includes('--check')) check();
else {
  serve();
  detectCoinGeckoPlan().finally(() => backfillHistory().finally(loop));
  setInterval(backfillHistory, 3 * 36e5);
}
