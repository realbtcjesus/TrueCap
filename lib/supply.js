// XBT (Bitcoin BLAKE2b) supply.
// The chain kept Bitcoin's full ledger and issuance schedule at the fork, so
// every coin mined since 2009 exists on it. Supply therefore follows Bitcoin's
// subsidy schedule up to the current XBT block height.

const COIN = 100000000n;
const HALVING_INTERVAL = 210000n;

// Same rule as Bitcoin Core's GetBlockSubsidy: 50 BTC >> halvings, in satoshis.
function blockSubsidySats(height) {
  const halvings = BigInt(height) / HALVING_INTERVAL;
  if (halvings >= 64n) return 0n;
  return (50n * COIN) >> halvings;
}

// Total coins issued by blocks 0..height inclusive (schedule supply).
// Note: the genesis coinbase (50) is unspendable and a few early miners
// under-claimed rewards; an RPC `gettxoutsetinfo` reading is exact, this is the
// protocol-schedule figure (within ~50 coins of the UTXO total).
function scheduledSupplySats(height) {
  let h = BigInt(height) + 1n; // number of blocks
  let total = 0n;
  let era = 0n;
  while (h > 0n && era < 64n) {
    const blocks = h < HALVING_INTERVAL ? h : HALVING_INTERVAL;
    total += blocks * ((50n * COIN) >> era);
    h -= blocks;
    era += 1n;
  }
  return total;
}

function satsToCoins(s) {
  return Number(s / COIN) + Number(s % COIN) / 1e8;
}

function scheduledSupply(height) {
  return satsToCoins(scheduledSupplySats(height));
}

function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

async function rpcCall(cfg, method, params = [], fetchImpl) {
  const headers = { 'content-type': 'application/json' };
  if (cfg.user || cfg.password) {
    headers.authorization = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }
  const res = await fetchImpl(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '1.0', id: 'truecap', method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

// Returns { supply, height, method, exact, detail }
async function resolveSupply(xbtCfg, fetchImpl, now = Date.now()) {
  const s = xbtCfg.supply;
  const errors = [];
  for (const src of s.sources) {
    try {
      if (src === 'rpc' && s.rpc && s.rpc.url && (s.rpc.user || s.rpc.password)) {
        const height = await rpcCall(s.rpc, 'getblockcount', [], fetchImpl);
        if (s.rpc.useTxOutSetInfo) {
          try {
            const info = await rpcCall(s.rpc, 'gettxoutsetinfo', [], fetchImpl);
            return {
              supply: Number(info.total_amount), height: info.height ?? height,
              method: 'node-utxo', exact: true,
              detail: 'Sum of every unspent output on your XBT node (gettxoutsetinfo).',
            };
          } catch (e) { errors.push('gettxoutsetinfo: ' + e.message); }
        }
        return {
          supply: scheduledSupply(height), height, method: 'node-height', exact: true,
          detail: 'Block height from your XBT node, supply from the issuance schedule.',
        };
      }
      if (src === 'explorer' && s.explorer && s.explorer.heightUrl) {
        const res = await fetchImpl(s.explorer.heightUrl);
        const text = await res.text();
        let height;
        try { height = Number(getPath(JSON.parse(text), s.explorer.heightJsonPath)); }
        catch { height = Number(text.trim()); }
        if (!Number.isFinite(height) || height < xbtCfg.forkHeight) throw new Error('bad height ' + text.slice(0, 80));
        return {
          supply: scheduledSupply(height), height, method: 'explorer-height', exact: true,
          detail: `Block height from ${new URL(s.explorer.heightUrl).host}, supply from the issuance schedule.`,
        };
      }
      if (src === 'estimate') {
        const e = s.estimate;
        const elapsed = (now - Date.parse(e.checkpointTime)) / 1000;
        const height = e.checkpointHeight + Math.max(0, Math.floor(elapsed / e.secondsPerBlock));
        return {
          supply: scheduledSupply(height), height, method: 'estimate', exact: false,
          detail: `Estimated height (${e.secondsPerBlock}s blocks since block ${e.checkpointHeight}). Connect a node or explorer for an exact figure.`,
        };
      }
    } catch (e) {
      errors.push(`${src}: ${e.message}`);
    }
  }
  throw new Error('No supply source worked: ' + errors.join('; '));
}

module.exports = { blockSubsidySats, scheduledSupplySats, scheduledSupply, resolveSupply };
