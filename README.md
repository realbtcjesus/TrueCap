# TrueCap

**Live site: https://truecap.net**

TrueCap is a crypto market-cap site in the style of CoinMarketCap. It lists the top 250 coins and includes **XBT** (the BLAKE2b proof-of-work chain that split from BTC at block 961,632) with its **full on-chain supply**.

CoinMarketCap and CoinGecko don't list XBT at all, and the site that does (CoinCarp) shows about 20,067 coins in circulation instead of about 20.1 million, so its market cap is about 1,000× too low. TrueCap works out XBT's price and supply itself.

It's plain Node.js 18 or newer, with no packages to install and no outside charting library.

---

## What's on the site

### The coin list
- The top 250 coins by market cap, with XBT ranked among them.
- Price, 1h / 24h / 7d change, market cap, 24h volume, circulating supply (with a bar showing how much of the maximum exists so far), and a 7-day mini-chart.
- Click a column heading to sort. The search box searches by name or ticker.
- **Watchlist:** click ☆ on any coin, then use the **★ Watchlist** tab. It's saved in the visitor's browser.
- A header bar shows the total market cap, 24h volume, and BTC / ETH / XBT dominance.

### The XBT page
- **Price** is the volume-weighted average across XBT's markets:
  - **NonKYC** (listed there as BTCB2): USDT and BTC pairs
  - **Neoxa Exchange** (BTCB2): USDT, USDC, BTC, XMR and NEOX pairs
  - **SafeTrade** (XBT): USDT, USDC and BTC pairs. SafeTrade blocks requests from cloud servers, so it usually shows "offline" on the live site. It's well under 1% of volume.
  - Pairs quoted in BTC, XMR or NEOX are converted to USD with CoinGecko prices.
  - A market more than 25% away from the median price is left out and marked "Excluded".
- **Supply** is exact: the current XBT block height comes from the **mempool.kilombino.com** explorer, and the supply follows the original 21-million issuance schedule up to that block. XBT kept BTC's full ledger at the split, so the coins inherited from BTC are counted. If the explorer is down, the site estimates the height from the last known block and labels the figure "Estimate".
- **Market cap** = price × total mined supply. The fully diluted value at 21M is shown alongside it.
- **1h / 24h / 7d changes and price history** come from the site's own price log. On startup, and every 3 hours after, it fills any gaps from Neoxa's chart data, so the history keeps working even after downtime.
- **Logo:** downloaded once from Neoxa, then kept on disk.

### Other coin pages
Data comes from CoinGecko and is fetched when someone opens the page, then kept for about 10 minutes: an all-time high and low, the 24h range, 30-day and 1-year changes, the top 25 markets (with CoinGecko's trust rating for each exchange), a short description, and links.

### Advanced charts (every coin)
- Candles or a line chart. XBT has 5m, 15m, 1H, 4H and 1D candles from Neoxa; other coins have 1D, 7D, 1M, 3M and 1Y from CoinGecko. CoinGecko's free and Basic plans don't include volume per candle, so only XBT shows volume bars.
- **Indicators:** any number of EMAs and SMAs (each with its own length and color), Bollinger Bands (adjustable length and width), volume, RSI, and MACD.
- **Drawing tools:** ray, trend line and horizontal line. The 🧲 **Snap** option locks points to the nearest candle's open, high, low or close, or to the ends of other drawings. Drawings can be selected, dragged, and deleted.
- **Moving around:** scroll to zoom (pinch on phones), drag to pan, double-click or double-tap to reset.
- Indicator settings are saved in the visitor's browser. Drawings are saved per coin.

### Phones and dark mode
- On phones, the list shows the rank, star, name, price with its 24h change, and a shortened market cap. Every page fits normal phone screens, and the charts support touch.
- **Dark mode:** the ☾ / ☀ button in the header switches between light and dark. Until a visitor chooses, the site follows their device setting. The choice is remembered.

---

## Running it on your own computer (Windows)

Double-click one of these files in the project folder:

| File | What it does |
|---|---|
| `1 - Preview with demo data.bat` | Runs the site with made-up sample data (purple **DEMO DATA** banner). Doesn't need internet. |
| `2 - Start TrueCap (live prices).bat` | Runs the site with live prices and opens it at http://localhost:8080 |
| `3 - Test the price sources.bat` | Checks each data source once and shows which ones worked |

Keep the black window open while you use the site; closing it stops the site. If the window says **"TrueCap is already running"**, an older copy is still open. Close it, or end **Node.js JavaScript Runtime** in Task Manager.

The `.bat` files need Node.js. If it's missing, they open the download page; install the **LTS** version with all the default options.

On Mac or Linux, use `npm run demo`, `npm start` or `npm run check` instead.

---

## Updating the live site

The live site runs on **Render** and is stored on **GitHub** (repository `TrueCap`). To publish changes:

1. Test them on your computer first.
2. On GitHub, upload each changed file into **the same folder it's in on your computer**. Use **Add file → Upload files**, then **Commit changes**. For example, `public/index.html` goes into the `public` folder on GitHub.
3. Render notices the change and updates truecap.net automatically. While it restarts, the site may show **"Bad Gateway"** for 1–3 minutes; that's normal.
4. If an update fails, open the **truecap** service in Render, look under **Events**, and check its **Logs**.

Hosting setup, Render settings, and how the domain is connected are described in **HOW-TO-PUT-ONLINE.md**.

### CoinGecko key
Set on Render as the environment variable `COINGECKO_API_KEY`. The site works out on its own whether the key is a free **Demo** key or a **paid** key, and uses the matching CoinGecko address. The startup log says which. Normal use takes about 30,000 requests a month, plus whatever visitors use opening coin pages. Your usage is shown in CoinGecko's Developer Dashboard.

---

## Settings (`config.json`)

| Setting | What it controls |
|---|---|
| `siteName` | The name in the logo, browser tab title and footer. A trailing "Cap" is highlighted in gold. |
| `nameOverrides` | Display names for CoinGecko coins, by CoinGecko id, e.g. `"bitcoin": "Spamcoin"` |
| `refreshSeconds` | How often prices update (default 120) |
| `topCoins` | How many coins to list (default 250, including XBT) |
| `xbt.name`, `xbt.symbol` | XBT's display name and ticker |
| `xbt.marketCapSupply` | `"total"` (all coins mined so far) or `"max"` (21M) for XBT's market cap |
| `xbt.markets` | The XBT exchanges and pairs used for the price |
| `xbt.outlierPct` | How far from the median price a market can be before it's excluded (default 25%) |
| `xbt.supply` | Where the block height comes from: your own node (`rpc`), the explorer, or the time-based estimate |
| `xbt.history`, `xbt.candles` | Neoxa addresses for past prices and chart candles |
| `xbt.logoUrl` | Where the XBT logo is downloaded from |

**Environment variables** (set on Render): `COINGECKO_API_KEY`; `DATA_DIR`, the folder for price history and the logo (`/var/data`, a persistent disk); and `PORT`.

---

## Data feeds (JSON)

| Address | Returns |
|---|---|
| `/api/v1/supply/xbt` | XBT supply as a plain number. This is the address to give CoinMarketCap or CoinGecko in a listing request. |
| `/api/v1/coins/markets` | All listed coins, in CoinGecko's `/coins/markets` format, with XBT included |
| `/api/xbt` | XBT detail: supply source and block height, per-market prices, and source status |
| `/api/xbt/history?days=7` | XBT's recorded price history (up to 35 days) |
| `/api/xbt/candles?interval=1h` | XBT candles: `5m`, `15m`, `1h`, `4h` or `1d` |
| `/api/coin/{id}`, `/api/coin/{id}/ohlc?days=30` | Coin details and candles (from CoinGecko, cached) |
| `/healthz` | Status check used by Render |

---

## Project files

```
server.js              the server: fetches data, ranks coins, serves the site and the data feeds above
config.json            settings (see above)
lib/supply.js          XBT supply: block height → coins issued
lib/markets.js         reads each exchange's price format and averages the prices
lib/mockfetch.js       demo data for the preview mode
public/index.html      the website (list, coin pages, watchlist, dark mode)
public/chart.js        the advanced chart: indicators and drawing tools
fixtures/              sample data for the preview mode
render.yaml            Render setup (always-on server and a 1 GB disk)
HOW-TO-PUT-ONLINE.md   hosting and domain guide
data/                  price history and logo on your computer (not uploaded to GitHub)
```

Prices are for information only and are not financial advice.
