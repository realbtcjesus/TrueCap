# TrueCap

A CoinMarketCap-style site that lists **Bitcoin BLAKE2b (XBT)** with its real supply and ranks it against the top coins.

CoinMarketCap and CoinGecko don't list XBT at all. CoinCarp lists it with about 20,067 coins in circulation, which is the real ~20.07 million figure with the last three digits dropped. That makes its market cap 1,000× too small. TrueCap builds the XBT entry itself:

- **Supply** comes from the XBT chain. At the split (block 961,632) XBT kept Bitcoin's full ledger and issuance schedule, so supply is Bitcoin's schedule up to the current XBT block height: about 20.07M at the fork, about 20.1M now, and capped at 20,999,999.9769.
- **Price** is the volume-weighted average of XBT markets on NonKYC, SafeTrade and Neoxa Exchange. BTC- and NEOX-quoted pairs are converted to USD, and outliers more than 25% from the median are dropped.
- **Market cap** is price × total mined supply. The XBT page also shows the fully diluted value at 21M.
- **Every other coin** (top 250) comes from CoinGecko's free API, and XBT is ranked among them by market cap.

No dependencies: plain Node.js 18+.

## Run it

```bash
npm run demo     # offline preview with sample data (purple DEMO banner)
npm run check    # test every live data source once
npm start        # live site at http://localhost:8080
```

## Make the supply exact

By default the supply is **estimated** from the time since the BLAKE2b activation block. The page labels it "Estimate". For an exact figure, set one of these in `config.json` → `xbt.supply`:

1. **Your own XBT node (best):** fill in `rpc.url`, `rpc.user` and `rpc.password` for a Bitcoin Knots BLAKE2b node. TrueCap calls `gettxoutsetinfo`, which sums every unspent coin, and falls back to `getblockcount` plus the schedule.
2. **A block explorer:** set `explorer.heightUrl` to any URL that returns the current XBT block height. That can be plain text, such as an Esplora `/blocks/tip/height`, or JSON with `heightJsonPath`.

## Exchange feeds

They're configured in `config.json` → `xbt.markets`. Two adapter types are built in:

| type | Format | Used for |
|---|---|---|
| `cg-tickers` | CoinGecko/CMC exchange-integration `/tickers` array (`ticker_id`, `last_price`, `base_volume`) | NonKYC, Neoxa |
| `peatio` | OpenDAX/Peatio `/api/v2/peatio/public/markets/tickers` | SafeTrade |

Endpoints and pair names should be confirmed with `npm run check`. Neoxa's public API path in particular is a best guess. If a source is down or wrong, the site keeps running on the others and shows that source as offline on the XBT page. To add another exchange, add an entry.

To use total mined supply for market cap (the default), keep `"marketCapSupply": "total"`. To use the 21M cap for market cap instead, set it to `"max"`.

## API

- `GET /api/v1/coins/markets`: all coins in CoinGecko's `/coins/markets` shape, with XBT included and ranked
- `GET /api/xbt`: XBT detail: supply source, block height, per-market prices
- `GET /api/xbt/history?days=7`: XBT price history, which the server records itself
- `GET /api/v1/supply/xbt`: plain-number supply, in the format aggregators accept for supply endpoints

`/api/v1/supply/xbt` is the URL to submit if you apply for an XBT listing on CoinMarketCap, CoinGecko or CoinCarp.

## Notes

- Price history starts when you first run the server and is stored in `data/history.json`. The 1h, 24h and 7d changes fill in as history builds up.
- CoinGecko's free tier is rate-limited. The default 120 s refresh stays well under the limit. Add a demo or pro key in `coingecko.apiKey` if you want to refresh faster.
- From block 973,440, newly mined XBT is locked for 45 days. Those coins still count toward total supply.
