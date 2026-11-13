// Offline fetch used when MOCK=1. Serves demo fixtures so the site can be
// previewed without network access. Demo numbers are illustrative only.
const fs = require('fs');
const path = require('path');

module.exports = function mockFetch(dir) {
  const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  let tick = 0;
  const wobble = () => 1 + Math.sin(tick++ / 3) * 0.004;
  const reply = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

  return async function (url, opts = {}) {
    const u = String(url);
    if (u.includes('/coins/markets')) return reply(load('cg-markets.json'));
    // Demo candles: a random walk ending at the coin's current price.
    const mkCandles = (n, stepMs, last, seedStr) => {
      let seed = [...seedStr].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const out = []; let p = last;
      const t0 = Math.floor(Date.now() / stepMs) * stepMs;
      for (let i = 0; i < n; i++) {
        const c = p, o = c * (1 + (rnd() - 0.5) * 0.02);
        const h = Math.max(o, c) * (1 + rnd() * 0.008), l = Math.min(o, c) * (1 - rnd() * 0.008);
        out.push({ t: t0 - i * stepMs, o, h, l, c, v: 5 + rnd() * 60 });
        p = o;
      }
      return out.reverse();
    };
    const nc = u.match(/\/candles\/[^?]+\?interval=(\w+)/);
    if (nc) {
      const step = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '1d': 864e5 }[nc[1]] || 36e5;
      return reply({ success: true, candles: mkCandles(400, step, 233, nc[1]).map((k) => ({ time: k.t / 1000, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v })) });
    }
    const oh = u.match(/\/coins\/([^/?]+)\/ohlc\?.*days=(\d+)/);
    if (oh) {
      const c = load('cg-markets.json').find((k) => k.id === oh[1]);
      const d = Number(oh[2]), step = d <= 2 ? 18e5 : d <= 30 ? 144e5 : 3456e5;
      return reply(mkCandles(Math.round((d * 864e5) / step), step, c.current_price, oh[1] + d).map((k) => [k.t, k.o, k.h, k.l, k.c]));
    }
    const chart = u.match(/\/coins\/([^/?]+)\/market_chart\?.*days=(\d+)/);
    if (chart) {
      const c = load('cg-markets.json').find((k) => k.id === chart[1]);
      const days = Number(chart[2]), n = days <= 1 ? 288 : days <= 30 ? days * 24 : days;
      let p = c.current_price * (1 - Math.min(0.5, days / 400)), out = [];
      for (let i = 0; i < n; i++) { p *= 1 + Math.sin(i / 7) * 0.003 + 0.0005; out.push([Date.now() - (n - i) * (days * 864e5 / n), p]); }
      out.push([Date.now(), c.current_price]);
      return reply({ prices: out, market_caps: out.map(([t, v]) => [t, v * c.circulating_supply]) });
    }
    const detail = u.match(/\/coins\/([^/?]+)\?/);
    if (detail) {
      const c = load('cg-markets.json').find((k) => k.id === detail[1]);
      const ex = ['Binance', 'Coinbase Exchange', 'Kraken', 'OKX', 'Bybit'];
      return reply({ id: c.id, name: c.name, symbol: c.symbol, genesis_date: null, categories: ['Demo category'],
        description: { en: `${c.name} demo description. In live mode this text comes from CoinGecko.` },
        links: { homepage: ['https://example.com'], blockchain_site: ['https://example.com/explorer'] },
        market_data: { ath: { usd: c.current_price * 1.4 }, ath_date: { usd: '2025-10-06T00:00:00Z' }, ath_change_percentage: { usd: -28.6 },
          atl: { usd: c.current_price * 0.01 }, atl_date: { usd: '2015-01-14T00:00:00Z' }, atl_change_percentage: { usd: 9900 },
          high_24h: { usd: c.current_price * 1.02 }, low_24h: { usd: c.current_price * 0.97 }, price_change_percentage_30d: 4.2, price_change_percentage_1y: 31.5 },
        tickers: ex.map((e, i) => ({ base: c.symbol.toUpperCase(), target: i % 2 ? 'USD' : 'USDT', market: { name: e }, trust_score: i < 4 ? 'green' : 'yellow',
          converted_last: { usd: c.current_price * (1 + (i - 2) * 0.0004) }, converted_volume: { usd: c.total_volume / (i + 2) }, trade_url: 'https://example.com' })) });
    }
    if (u.includes('/global')) return reply(load('cg-global.json'));
    if (u.includes('/simple/price')) return reply(load('cg-simple.json'));
    if (u.includes('nonkyc')) {
      const w = wobble();
      return reply(load('nonkyc-tickers.json').map((t) => ({ ...t, last_price: String(Number(t.last_price) * w) })));
    }
    if (u.includes('safe.trade') || u.includes('safetrade.com')) return reply(load('safetrade-tickers.json'));
    if (u.includes('neoxa')) return reply(load('neoxa-tickers.json'));
    if (opts.method === 'POST') return { ok: false, status: 503, json: async () => ({ error: { message: 'no node in mock' } }) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
};
