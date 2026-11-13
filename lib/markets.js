// XBT exchange adapters + price aggregation.
// Each adapter returns rows: { exchange, pair, base, quote, last, baseVolume, changePct, url }

const num = (v) => (v == null || v === '' ? NaN : Number(v));
const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function splitPair(pair, symbols) {
  const p = String(pair);
  if (/[_\-/]/.test(p)) {
    const [b, q] = p.split(/[_\-/]/);
    return [b.toUpperCase(), q.toUpperCase()];
  }
  const up = p.toUpperCase();
  for (const s of symbols) {
    if (up.startsWith(s)) return [s, up.slice(s.length)];
  }
  return [up.slice(0, 3), up.slice(3)];
}

// CoinGecko / CMC "integration standard" tickers: array of
// { ticker_id, base_currency, target_currency, last_price, base_volume, ... }
// Also tolerates NonKYC's native field names (symbol/lastPrice/volume).
function parseCgTickers(json, m, symbols) {
  const list = Array.isArray(json) ? json : (json.tickers || json.data || Object.values(json));
  const wanted = new Set(m.pairs.map(norm));
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const id = t.ticker_id || t.pair || t.symbol || t.market || t.pair || (t.base_currency && `${t.base_currency}_${t.target_currency}`);
    if (!id || !wanted.has(norm(id))) continue;
    let [base, quote] = t.base_currency ? [t.base_currency.toUpperCase(), String(t.target_currency).toUpperCase()] : t.baseToken ? [t.baseToken.toUpperCase(), String(t.quoteToken).toUpperCase()] : splitPair(id, symbols);
    if (symbols.includes(base)) base = symbols[0]; // show aliases (e.g. BTCB2) as XBT
    out.push({
      exchange: m.exchange, pair: `${base}/${quote}`, base, quote,
      last: num(t.last_price ?? t.lastPrice ?? t.last),
      baseVolume: num(t.base_volume ?? t.baseVolume ?? t.volume24h ?? t.volume),
      changePct: num(String(t.price_change_percent_24h ?? t.changePercent24h ?? t.changePercent ?? t.change_percent ?? t.change ?? '').replace('%', '')),
      bid: num(t.bid ?? t.bestBid), ask: num(t.ask ?? t.bestAsk),
      url: m.url,
    });
  }
  return out;
}

// Peatio / OpenDAX: { "xbtusdt": { at, ticker: { last, amount (base vol), volume (quote vol), price_change_percent } } }
function parsePeatio(json, m, symbols) {
  const out = [];
  for (const key of m.pairs) {
    const entry = json[key] || json[key.toLowerCase()];
    if (!entry) continue;
    const t = entry.ticker || entry;
    let [base, quote] = splitPair(key, symbols);
    if (symbols.includes(base)) base = symbols[0];
    const last = num(t.last);
    let baseVol = num(t.amount);
    if (!Number.isFinite(baseVol)) baseVol = num(t.vol);
    if (!Number.isFinite(baseVol) && last > 0) baseVol = num(t.volume) / last;
    out.push({
      exchange: m.exchange, pair: `${base}/${quote}`, base, quote, last,
      baseVolume: baseVol,
      changePct: num(String(t.price_change_percent || '').replace('%', '')),
      bid: num(t.buy), ask: num(t.sell), url: m.url,
    });
  }
  return out;
}

const ADAPTERS = { 'cg-tickers': parseCgTickers, peatio: parsePeatio };

async function fetchMarket(m, fetchImpl, symbols) {
  const res = await fetchImpl(m.endpoint, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (TrueCap price tracker)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const parse = ADAPTERS[m.type];
  if (!parse) throw new Error('unknown adapter type ' + m.type);
  return parse(json, m, symbols);
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

// quoteUsd: { USDT: 1.0002, BTC: 80000, ... }
function aggregate(rows, quoteUsd, outlierPct) {
  const priced = [];
  for (const r of rows) {
    const q = quoteUsd[r.quote];
    if (!q || !(r.last > 0)) { priced.push({ ...r, priceUsd: null, volumeUsd: 0, excluded: 'no USD rate for quote' }); continue; }
    const priceUsd = r.last * q;
    priced.push({ ...r, priceUsd, volumeUsd: (r.baseVolume > 0 ? r.baseVolume : 0) * priceUsd });
  }
  const valid = priced.filter((r) => r.priceUsd != null);
  if (!valid.length) return { price: null, volume: 0, markets: priced };
  const med = median(valid.map((r) => r.priceUsd));
  for (const r of valid) {
    if (Math.abs(r.priceUsd / med - 1) * 100 > outlierPct) r.excluded = `>${outlierPct}% from median`;
  }
  const used = valid.filter((r) => !r.excluded);
  const vol = used.reduce((s, r) => s + r.volumeUsd, 0);
  const price = vol > 0
    ? used.reduce((s, r) => s + r.priceUsd * r.volumeUsd, 0) / vol
    : median(used.map((r) => r.priceUsd));
  const chg = used.filter((r) => Number.isFinite(r.changePct));
  const chgVol = chg.reduce((s, r) => s + r.volumeUsd, 0);
  const change24h = chg.length ? (chgVol > 0 ? chg.reduce((s, r) => s + r.changePct * r.volumeUsd, 0) / chgVol : median(chg.map((r) => r.changePct))) : null;
  priced.sort((a, b) => b.volumeUsd - a.volumeUsd);
  for (const r of priced) r.share = vol > 0 && !r.excluded && r.priceUsd != null ? r.volumeUsd / vol : 0;
  return { price, volume: vol, change24hFromExchanges: change24h, markets: priced };
}

module.exports = { fetchMarket, aggregate, parseCgTickers, parsePeatio, splitPair };
