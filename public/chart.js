// TrueCap advanced chart: candles/line, EMA/SMA, Bollinger Bands, volume, RSI,
// MACD, crosshair, zoom/pan, and drawing tools (ray, trend line, horizontal
// line) with a magnet that snaps to candle open/high/low/close.
// No outside libraries. Settings and drawings are kept in the browser.
(function () {
  'use strict';

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  const DEFAULT_IND = {
    ema: [{ on: true, period: 20, color: '#f59e0b' }, { on: true, period: 50, color: '#3b82f6' }, { on: false, period: 200, color: '#a855f7' }],
    sma: [{ on: false, period: 50, color: '#14b8a6' }],
    bb: { on: false, period: 20, mult: 2, color: '#8b5cf6' },
    volume: { on: true },
    rsi: { on: false, period: 14 },
    macd: { on: false, fast: 12, slow: 26, signal: 9 },
  };

  // ---------- indicator math ----------
  function sma(vals, n) {
    const out = new Array(vals.length).fill(null); let s = 0;
    for (let i = 0; i < vals.length; i++) {
      s += vals[i]; if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function ema(vals, n) {
    const out = new Array(vals.length).fill(null); if (vals.length < n) return out;
    const k = 2 / (n + 1); let e = 0;
    for (let i = 0; i < n; i++) e += vals[i];
    e /= n; out[n - 1] = e;
    for (let i = n; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  function emaOfNullable(vals, n) { // EMA over a series that starts with nulls
    const start = vals.findIndex((v) => v != null);
    if (start < 0) return vals.map(() => null);
    const part = ema(vals.slice(start), n);
    return vals.map((_, i) => (i < start ? null : part[i - start]));
  }
  function bollinger(vals, n, mult) {
    const mid = sma(vals, n), up = [], lo = [];
    for (let i = 0; i < vals.length; i++) {
      if (mid[i] == null) { up.push(null); lo.push(null); continue; }
      let v = 0; for (let j = i - n + 1; j <= i; j++) v += (vals[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / n); up.push(mid[i] + mult * sd); lo.push(mid[i] - mult * sd);
    }
    return { mid, up, lo };
  }
  function rsi(vals, n) {
    const out = new Array(vals.length).fill(null); if (vals.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(vals, f, s, sig) {
    const a = ema(vals, f), b = ema(vals, s);
    const line = vals.map((_, i) => (a[i] != null && b[i] != null ? a[i] - b[i] : null));
    const signal = emaOfNullable(line, sig);
    return { line, signal, hist: line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null)) };
  }

  // ---------- formatting ----------
  function fmtPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtTime(t, step) {
    const d = new Date(t);
    if (step < 864e5) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function niceStep(range, target) {
    const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  function distToSeg(px, py, x1, y1, x2, y2, infinite) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    if (!infinite) t = Math.max(0, Math.min(1, t)); else t = Math.max(0, t);
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  const css = `
  .xc{border:1px solid var(--line);border-radius:14px;margin-top:10px;position:relative;background:var(--bg);user-select:none}
  .xc-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line)}
  .xc-grp{display:flex;gap:2px;background:var(--bg2);border-radius:8px;padding:2px}
  .xc-bar button{border:0;background:none;color:var(--muted);font:inherit;font-size:12px;font-weight:700;padding:5px 9px;border-radius:6px;cursor:pointer;line-height:1.2}
  .xc-bar button:hover{color:var(--fg)}
  .xc-bar button.on{background:var(--bg);color:var(--fg);box-shadow:0 1px 2px rgba(0,0,0,.1)}
  .xc-sp{flex:1}
  .xc canvas{display:block;width:100%;touch-action:none}
  .xc-body{position:relative}
  .xc-legend{position:absolute;left:12px;top:10px;max-width:calc(100% - 100px);font-size:11.5px;pointer-events:none;line-height:1.55;color:var(--muted);text-shadow:0 0 3px var(--bg)}
  .xc-legend b{color:var(--fg);font-weight:600}
  .xc-msg{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:13px;pointer-events:none}
  .xc-pop{position:absolute;right:10px;top:46px;z-index:5;width:310px;max-height:440px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px;font-size:12.5px}
  .xc-pop h4{margin:10px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .xc-pop h4:first-child{margin-top:0}
  .xc-row{display:flex;align-items:center;gap:8px;margin:5px 0}
  .xc-row label{flex:1}
  .xc-row input[type=number]{width:58px;padding:3px 5px;border:1px solid var(--line);border-radius:6px;background:var(--bg2);color:var(--fg);font:inherit}
  .xc-row input[type=color]{width:26px;height:22px;border:0;padding:0;background:none;cursor:pointer}
  .xc-row .x{border:0;background:none;color:var(--muted);cursor:pointer;font-size:14px}
  .xc-add{border:1px dashed var(--line);background:none;color:var(--fg);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer}
  .xc-hint{font-size:11.5px;color:var(--muted);padding:6px 12px 10px}
  .xc-pop{max-width:calc(100% - 20px)}
  @media (max-width:760px){
    .xc-bar{padding:6px;gap:4px}
    .xc-bar button{padding:5px 7px;font-size:11.5px}
    .xc-sp{flex-basis:100%;height:0}
    .xc-legend{font-size:10.5px;top:6px;left:8px;max-width:calc(100% - 70px)}
    .xc-hint .desk{display:none}
  }
  @media (min-width:761px){ .xc-hint .mob{display:none} }
  `;
  function injectCss() {
    if (document.getElementById('xc-css')) return;
    const s = document.createElement('style'); s.id = 'xc-css'; s.textContent = css; document.head.appendChild(s);
  }

  // ---------- chart ----------
  class XChart {
    /**
     * opts: { key, timeframes:[{id,label}], timeframe, load(tfId) -> Promise<candles>, hasVolume }
     * candles: [{t (ms), o, h, l, c, v?}]
     */
    constructor(host, opts) {
      injectCss();
      this.host = host; this.opts = opts; host._xchart = this;
      this.ind = Object.assign(JSON.parse(JSON.stringify(DEFAULT_IND)), store.get('xbtcap.ind', {}));
      this.type = store.get('xbtcap.ctype', 'candles');
      this.tf = opts.timeframe;
      this.tool = 'cursor'; this.magnet = store.get('xbtcap.magnet', true);
      this.drawings = store.get('xbtcap.draw.' + opts.key, []);
      this.data = []; this.barW = 8; this.end = 0; this.mouse = null; this.pending = null; this.sel = -1; this.drag = null;
      this.build();
      this.loadTf(this.tf);
    }

    build() {
      const o = this.opts;
      this.host.innerHTML = '';
      const root = document.createElement('div'); root.className = 'xc'; this.root = root;
      root.innerHTML = `
        <div class="xc-bar">
          <div class="xc-grp" data-g="tf">${o.timeframes.map((t) => `<button data-tf="${t.id}">${t.label}</button>`).join('')}</div>
          <div class="xc-grp" data-g="type"><button data-type="candles" title="Candlesticks">Candles</button><button data-type="line" title="Line">Line</button></div>
          <button data-act="ind" title="Indicators">ƒx Indicators</button>
          <span class="xc-sp"></span>
          <div class="xc-grp" data-g="tool">
            <button data-tool="cursor" title="Select / move (Esc)">↖</button>
            <button data-tool="ray" title="Ray: click two points">Ray</button>
            <button data-tool="trend" title="Trend line: click two points">Trend</button>
            <button data-tool="hline" title="Horizontal line: one click">H-line</button>
          </div>
          <button data-act="magnet" title="Magnet: snap points to candle open/high/low/close">🧲 Snap</button>
          <button data-act="clear" title="Remove all drawings on this coin">Clear</button>
        </div>
        <div class="xc-body"><canvas></canvas>
        <div class="xc-legend"></div>
        <div class="xc-msg">Loading chart…</div></div>
        <div class="xc-hint"><span class="desk">Scroll to zoom · drag to move · double-click to reset · select a drawing and press Delete to remove it</span><span class="mob">Pinch to zoom · drag to move · double-tap to reset · tap a drawing, then <button class="xc-add" data-act="delsel" style="padding:1px 6px">Delete</button></span></div>`;
      this.host.appendChild(root);
      this.cv = root.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
      this.legend = root.querySelector('.xc-legend'); this.msg = root.querySelector('.xc-msg');

      root.querySelector('.xc-bar').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tf) this.loadTf(b.dataset.tf);
        else if (b.dataset.type) { this.type = b.dataset.type; store.set('xbtcap.ctype', this.type); this.syncBar(); this.draw(); }
        else if (b.dataset.tool) { this.tool = b.dataset.tool; this.pending = null; this.syncBar(); this.draw(); }
        else if (b.dataset.act === 'magnet') { this.magnet = !this.magnet; store.set('xbtcap.magnet', this.magnet); this.syncBar(); }
        else if (b.dataset.act === 'clear') { if (this.drawings.length) { this.drawings = []; this.sel = -1; this.saveDrawings(); this.draw(); } }
        else if (b.dataset.act === 'ind') this.togglePanel();
      });
      this.syncBar();
      root.querySelector('.xc-hint').addEventListener('click', (e) => {
        if (e.target.closest('[data-act=delsel]') && this.sel >= 0) { this.drawings.splice(this.sel, 1); this.sel = -1; this.saveDrawings(); this.draw(); }
      });

      const cv = this.cv;
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.onWheel(e); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => this.onDown(e));
      cv.addEventListener('pointermove', (e) => this.onMove(e));
      cv.addEventListener('pointerup', (e) => this.onUp(e));
      cv.addEventListener('pointercancel', (e) => this.onUp(e));
      cv.addEventListener('pointerleave', () => { if (!this.drag) { this.mouse = null; this.draw(); } });
      cv.addEventListener('dblclick', () => this.resetView());
      this.keyHandler = (e) => {
        if (!document.body.contains(this.root)) { document.removeEventListener('keydown', this.keyHandler); return; }
        if (/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) {
          this.drawings.splice(this.sel, 1); this.sel = -1; this.saveDrawings(); this.draw(); e.preventDefault();
        } else if (e.key === 'Escape') { this.pending = null; this.sel = -1; this.tool = 'cursor'; this.syncBar(); this.draw(); }
      };
      document.addEventListener('keydown', this.keyHandler);
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(this.root);
    }

    syncBar() {
      const q = (s) => this.root.querySelectorAll(s);
      q('[data-tf]').forEach((b) => b.classList.toggle('on', b.dataset.tf === this.tf));
      q('[data-type]').forEach((b) => b.classList.toggle('on', b.dataset.type === this.type));
      q('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
      q('[data-act=magnet]').forEach((b) => b.classList.toggle('on', this.magnet));
      this.cv.style.cursor = this.tool === 'cursor' ? 'default' : 'crosshair';
    }

    async loadTf(tf) {
      this.tf = tf; this.syncBar();
      this.msg.style.display = 'grid'; this.msg.textContent = 'Loading chart…';
      try {
        const d = await this.opts.load(tf);
        if (tf !== this.tf) return;
        if (!d || d.length < 2) throw new Error('No chart data for this timeframe yet.');
        this.data = d; this.msg.style.display = 'none';
        this.step = this.medianStep(); this.compute(); this.resetView();
      } catch (e) {
        if (tf !== this.tf) return;
        this.data = []; this.msg.textContent = e.message || 'Chart unavailable.'; this.draw();
      }
    }

    medianStep() {
      const d = this.data, diffs = [];
      for (let i = 1; i < d.length; i++) diffs.push(d[i].t - d[i - 1].t);
      diffs.sort((a, b) => a - b);
      return diffs[Math.floor(diffs.length / 2)] || 36e5;
    }

    compute() {
      const c = this.data.map((k) => k.c), I = this.ind;
      this.calc = {
        ema: I.ema.map((e) => (e.on ? ema(c, Math.max(1, e.period | 0)) : null)),
        sma: I.sma.map((e) => (e.on ? sma(c, Math.max(1, e.period | 0)) : null)),
        bb: I.bb.on ? bollinger(c, Math.max(2, I.bb.period | 0), +I.bb.mult || 2) : null,
        rsi: I.rsi.on ? rsi(c, Math.max(2, I.rsi.period | 0)) : null,
        macd: I.macd.on ? macd(c, I.macd.fast | 0 || 12, I.macd.slow | 0 || 26, I.macd.signal | 0 || 9) : null,
      };
    }

    saveInd() { store.set('xbtcap.ind', this.ind); this.compute(); this.draw(); }
    saveDrawings() { store.set('xbtcap.draw.' + this.opts.key, this.drawings); }

    resetView() {
      const w = this.plotW || 700;
      this.barW = Math.max(3, Math.min(14, (w / Math.min(this.data.length || 1, w < 500 ? 60 : 140)) || 8));
      this.end = (this.data.length - 1) + 4;
      this.draw();
    }

    // ---------- geometry ----------
    layout() {
      const W = this.root.clientWidth, dpr = window.devicePixelRatio || 1;
      const sub = (this.ind.rsi.on ? 1 : 0) + (this.ind.macd.on ? 1 : 0);
      const mainH = W < 500 ? Math.round(Math.max(240, W * 0.75)) : Math.max(260, Math.min(420, Math.round(W * 0.48)));
      const subH = W < 500 ? 80 : 96, axisH = 24, H = mainH + sub * subH + axisH;
      if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
        this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.cv.style.height = H + 'px';
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = W; this.H = H; this.axisW = W < 500 ? 60 : 72; this.plotW = W - this.axisW;
      this.panes = { main: { top: 8, h: mainH - 8 } };
      let y = mainH;
      if (this.ind.rsi.on) { this.panes.rsi = { top: y + 6, h: subH - 10 }; y += subH; }
      if (this.ind.macd.on) { this.panes.macd = { top: y + 6, h: subH - 10 }; y += subH; }
      this.timeY = y;
    }
    x(i) { return this.plotW - (this.end - i) * this.barW; }
    idxAt(px) { return this.end - (this.plotW - px) / this.barW; }
    tToIdx(t) {
      const d = this.data, n = d.length;
      if (t <= d[0].t) return (t - d[0].t) / this.step;
      if (t >= d[n - 1].t) return n - 1 + (t - d[n - 1].t) / this.step;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m].t <= t) lo = m; else hi = m; }
      return lo + (t - d[lo].t) / ((d[hi].t - d[lo].t) || 1);
    }
    idxToT(i) {
      const d = this.data, n = d.length;
      if (i <= 0) return d[0].t + i * this.step;
      if (i >= n - 1) return d[n - 1].t + (i - (n - 1)) * this.step;
      const a = Math.floor(i), f = i - a;
      return d[a].t + f * (d[a + 1].t - d[a].t);
    }
    y(p) { const m = this.panes.main; return m.top + ((this.hi - p) / (this.hi - this.lo)) * m.h; }
    priceAt(py) { const m = this.panes.main; return this.hi - ((py - m.top) / m.h) * (this.hi - this.lo); }

    // ---------- drawing ----------
    draw() {
      if (!this.root.isConnected) return;
      this.layout();
      const ctx = this.ctx, d = this.data, cs = getComputedStyle(document.documentElement);
      const C = {
        up: cs.getPropertyValue('--up').trim() || '#16a34a', down: cs.getPropertyValue('--down').trim() || '#dc2626',
        line: cs.getPropertyValue('--line').trim() || '#eee', muted: cs.getPropertyValue('--muted').trim() || '#888',
        fg: cs.getPropertyValue('--fg').trim() || '#111', bg: cs.getPropertyValue('--bg').trim() || '#fff', accent: '#f7b500',
      };
      this.C = C;
      ctx.clearRect(0, 0, this.W, this.H);
      if (!d.length) { this.legend.innerHTML = ''; return; }

      this.end = Math.max(5, Math.min(d.length - 1 + this.plotW / this.barW * 0.85, this.end));
      const i0 = Math.max(0, Math.floor(this.idxAt(0))), i1 = Math.min(d.length - 1, Math.ceil(this.end));
      if (i1 < i0) return;

      // price range over visible bars and overlays
      let hi = -Infinity, lo = Infinity;
      const consider = (v) => { if (v != null && isFinite(v)) { if (v > hi) hi = v; if (v < lo) lo = v; } };
      for (let i = i0; i <= i1; i++) {
        if (this.type === 'candles') { consider(d[i].h); consider(d[i].l); } else consider(d[i].c);
        this.calc.ema.forEach((s) => s && consider(s[i])); this.calc.sma.forEach((s) => s && consider(s[i]));
        if (this.calc.bb) { consider(this.calc.bb.up[i]); consider(this.calc.bb.lo[i]); }
      }
      if (!isFinite(hi)) { hi = d[d.length - 1].c * 1.01; lo = d[d.length - 1].c * 0.99; }
      const pad = (hi - lo) * 0.08 || hi * 0.01; this.hi = hi + pad; this.lo = lo - pad;

      const m = this.panes.main;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.plotW, this.timeY); ctx.clip();

      // grid
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif';
      const pStep = niceStep(this.hi - this.lo, 6);
      for (let p = Math.ceil(this.lo / pStep) * pStep; p < this.hi; p += pStep) {
        const yy = Math.round(this.y(p)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy); ctx.stroke();
      }
      const every = Math.max(1, Math.round((this.W < 500 ? 90 : 110) / this.barW));
      for (let i = Math.ceil(i0 / every) * every; i <= i1; i += every) {
        const xx = Math.round(this.x(i)) + 0.5; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, this.timeY); ctx.stroke();
      }

      // Bollinger fill
      if (this.calc.bb) {
        const bb = this.calc.bb, col = this.ind.bb.color;
        ctx.beginPath(); let started = false;
        for (let i = i0; i <= i1; i++) if (bb.up[i] != null) { const X = this.x(i), Y = this.y(bb.up[i]); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; }
        for (let i = i1; i >= i0; i--) if (bb.lo[i] != null) ctx.lineTo(this.x(i), this.y(bb.lo[i]));
        ctx.fillStyle = col + '1a'; ctx.fill();
        this.line(bb.up, i0, i1, col, 1); this.line(bb.lo, i0, i1, col, 1); this.line(bb.mid, i0, i1, col, 1, [4, 3]);
      }

      // volume
      if (this.ind.volume.on && this.opts.hasVolume) {
        let vmax = 0; for (let i = i0; i <= i1; i++) vmax = Math.max(vmax, d[i].v || 0);
        const vh = m.h * 0.2, bw = Math.max(1, this.barW * 0.7);
        for (let i = i0; i <= i1; i++) {
          const v = d[i].v || 0; if (!vmax || !v) continue;
          const h = (v / vmax) * vh;
          ctx.fillStyle = (d[i].c >= d[i].o ? C.up : C.down) + '40';
          ctx.fillRect(this.x(i) - bw / 2, m.top + m.h - h, bw, h);
        }
      }

      // price
      if (this.type === 'candles') {
        const bw = Math.max(1, this.barW * 0.7);
        for (let i = i0; i <= i1; i++) {
          const k = d[i], X = Math.round(this.x(i)) + 0.5, up = k.c >= k.o;
          ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
          ctx.beginPath(); ctx.moveTo(X, this.y(k.h)); ctx.lineTo(X, this.y(k.l)); ctx.stroke();
          const yo = this.y(k.o), yc = this.y(k.c);
          ctx.fillRect(X - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
        }
      } else {
        this.line(d.map((k) => k.c), i0, i1, d[i1].c >= d[i0].c ? C.up : C.down, 2);
      }

      this.calc.sma.forEach((s, j) => s && this.line(s, i0, i1, this.ind.sma[j].color, 1.5));
      this.calc.ema.forEach((s, j) => s && this.line(s, i0, i1, this.ind.ema[j].color, 1.5));

      // drawings
      this.drawDrawings();
      ctx.restore();

      // sub panes
      if (this.panes.rsi) this.drawRsi(i0, i1);
      if (this.panes.macd) this.drawMacd(i0, i1);

      // axes
      ctx.fillStyle = C.bg; ctx.fillRect(this.plotW, 0, this.axisW, this.H); ctx.fillRect(0, this.timeY, this.W, this.H - this.timeY);
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(this.plotW + 0.5, 0); ctx.lineTo(this.plotW + 0.5, this.H); ctx.moveTo(0, this.timeY + 0.5); ctx.lineTo(this.W, this.timeY + 0.5); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textBaseline = 'middle';
      for (let p = Math.ceil(this.lo / pStep) * pStep; p < this.hi; p += pStep) {
        const yy = this.y(p); if (yy < m.top + 6 || yy > m.top + m.h - 4) continue;
        ctx.fillText(fmtPrice(p), this.plotW + 8, yy);
      }
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
      for (let i = Math.ceil(i0 / every) * every; i <= i1; i += every) {
        const lbl = this.step < 864e5 ? (this.W < 500 ? (this.step < 36e5 ? new Date(d[i].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(d[i].t).toLocaleDateString([], { month: 'short', day: 'numeric' })) : new Date(d[i].t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : new Date(d[i].t).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
        ctx.fillText(lbl, this.x(i), this.timeY + 16);
      }
      ctx.textAlign = 'left';

      // last price tag
      const last = d[d.length - 1], ly = this.y(last.c);
      if (ly > m.top && ly < m.top + m.h) {
        const col = last.c >= last.o ? C.up : C.down;
        ctx.setLineDash([2, 3]); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(this.plotW, ly); ctx.stroke(); ctx.setLineDash([]);
        this.tag(ly, fmtPrice(last.c), col, '#fff');
      }

      this.drawCrosshair();
    }

    line(arr, i0, i1, color, w, dash) {
      const ctx = this.ctx; ctx.beginPath(); let started = false;
      for (let i = i0; i <= i1; i++) {
        const v = arr[i]; if (v == null) { started = false; continue; }
        const X = this.x(i), Y = this.y(v); started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true;
      }
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }

    tag(y, text, bg, fg) {
      const ctx = this.ctx; ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = bg; ctx.fillRect(this.plotW + 1, y - 9, this.axisW - 2, 18);
      ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, this.plotW + 7, y); ctx.textBaseline = 'alphabetic';
      ctx.font = '11px system-ui, sans-serif';
    }

    subPane(p, lo, hi, label, i0, i1, drawFn) {
      const ctx = this.ctx, C = this.C, Y = (v) => p.top + ((hi - v) / (hi - lo)) * p.h;
      ctx.save(); ctx.beginPath(); ctx.rect(0, p.top - 6, this.plotW, p.h + 10); ctx.clip();
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, p.top - 5.5); ctx.lineTo(this.plotW, p.top - 5.5); ctx.stroke();
      drawFn(Y);
      ctx.restore();
      ctx.fillStyle = C.muted; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(label, 8, p.top + 10);
      return Y;
    }

    drawRsi(i0, i1) {
      const p = this.panes.rsi, r = this.calc.rsi, C = this.C, ctx = this.ctx;
      const Y = this.subPane(p, 0, 100, `RSI ${this.ind.rsi.period}`, i0, i1, (Y) => {
        ctx.fillStyle = '#8b5cf614'; ctx.fillRect(0, Y(70), this.plotW, Y(30) - Y(70));
        ctx.setLineDash([3, 3]); ctx.strokeStyle = C.muted; [70, 30].forEach((v) => { ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(this.plotW, Y(v)); ctx.stroke(); }); ctx.setLineDash([]);
        ctx.beginPath(); let s = false;
        for (let i = i0; i <= i1; i++) { if (r[i] == null) continue; const X = this.x(i); s ? ctx.lineTo(X, Y(r[i])) : ctx.moveTo(X, Y(r[i])); s = true; }
        ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
      });
      this.subAxis([70, 30], Y);
      this.subY = this.subY || {}; this.subY.rsi = Y;
    }

    drawMacd(i0, i1) {
      const p = this.panes.macd, M = this.calc.macd, C = this.C, ctx = this.ctx;
      let hi = -Infinity, lo = Infinity;
      for (let i = i0; i <= i1; i++) [M.line[i], M.signal[i], M.hist[i]].forEach((v) => { if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
      if (!isFinite(hi)) { hi = 1; lo = -1; }
      const pad = (hi - lo) * 0.1 || 1; hi += pad; lo -= pad;
      const I = this.ind.macd;
      const Y = this.subPane(p, lo, hi, `MACD ${I.fast} ${I.slow} ${I.signal}`, i0, i1, (Y) => {
        const bw = Math.max(1, this.barW * 0.6), z = Y(0);
        for (let i = i0; i <= i1; i++) { const h = M.hist[i]; if (h == null) continue; ctx.fillStyle = (h >= 0 ? C.up : C.down) + '88'; ctx.fillRect(this.x(i) - bw / 2, Math.min(z, Y(h)), bw, Math.abs(Y(h) - z)); }
        const ln = (arr, col) => { ctx.beginPath(); let s = false; for (let i = i0; i <= i1; i++) { if (arr[i] == null) continue; const X = this.x(i); s ? ctx.lineTo(X, Y(arr[i])) : ctx.moveTo(X, Y(arr[i])); s = true; } ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; };
        ln(M.line, '#3b82f6'); ln(M.signal, '#f59e0b');
      });
      this.subAxis([0], Y);
      this.subY = this.subY || {}; this.subY.macd = Y;
    }

    subAxis(levels, Y) {
      const ctx = this.ctx; ctx.fillStyle = this.C.muted; ctx.textBaseline = 'middle';
      levels.forEach((v) => ctx.fillText(String(v), this.plotW + 8, Y(v)));
      ctx.textBaseline = 'alphabetic';
    }

    drawingPx(dr) {
      const p1 = { x: this.x(this.tToIdx(dr.p1.t)), y: this.y(dr.p1.p) };
      const p2 = dr.p2 ? { x: this.x(this.tToIdx(dr.p2.t)), y: this.y(dr.p2.p) } : null;
      return { p1, p2 };
    }

    drawDrawings() {
      const ctx = this.ctx, list = this.drawings.slice();
      if (this.pending && this.mouse) list.push({ type: this.pending.type, p1: this.pending.p1, p2: this.snapPoint(this.mouse.x, this.mouse.y), preview: true });
      list.forEach((dr, idx) => {
        const sel = idx === this.sel && !dr.preview;
        const col = dr.color || '#2563eb';
        ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.5 : 1.75; ctx.setLineDash(dr.preview ? [5, 4] : []);
        const { p1, p2 } = this.drawingPx(dr);
        ctx.beginPath();
        if (dr.type === 'hline') { ctx.moveTo(0, p1.y); ctx.lineTo(this.plotW, p1.y); }
        else if (p2) {
          ctx.moveTo(p1.x, p1.y);
          if (dr.type === 'ray') {
            const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1, far = 1e5;
            ctx.lineTo(p1.x + (dx / len) * far, p1.y + (dy / len) * far);
          } else ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        if (dr.type === 'hline' && !dr.preview) this.pendingTags = (this.pendingTags || []).concat([{ y: p1.y, p: dr.p1.p, col }]);
        if (sel || dr.preview) {
          [p1, p2].forEach((pt) => { if (!pt) return; ctx.fillStyle = this.C.bg; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1; });
        }
      });
    }

    drawCrosshair() {
      const ctx = this.ctx, C = this.C, d = this.data;
      (this.pendingTags || []).forEach((t) => { if (t.y > this.panes.main.top && t.y < this.panes.main.top + this.panes.main.h) this.tag(t.y, fmtPrice(t.p), t.col, '#fff'); });
      this.pendingTags = [];
      let i = d.length - 1;
      if (this.mouse && this.mouse.x < this.plotW) {
        const sp = this.tool !== 'cursor' ? this.snapPoint(this.mouse.x, this.mouse.y) : null;
        const mx = sp ? this.x(this.tToIdx(sp.t)) : this.mouse.x;
        const my = sp && this.mouse.y <= this.panes.main.top + this.panes.main.h ? this.y(sp.p) : this.mouse.y;
        i = Math.max(0, Math.min(d.length - 1, Math.round(this.idxAt(mx))));
        const X = sp ? mx : this.x(i);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = C.muted;
        ctx.beginPath(); ctx.moveTo(X + 0.5, 0); ctx.lineTo(X + 0.5, this.timeY); ctx.moveTo(0, my + 0.5); ctx.lineTo(this.plotW, my + 0.5); ctx.stroke(); ctx.setLineDash([]);
        if (sp && sp.snapped) { ctx.strokeStyle = '#f7b500'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, my, 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
        if (my <= this.panes.main.top + this.panes.main.h) this.tag(my, fmtPrice(this.priceAt(my)), C.fg, C.bg);
        const tl = fmtTime(this.idxToT(this.idxAt(X)), this.step);
        ctx.font = '600 11px system-ui, sans-serif'; const tw = ctx.measureText(tl).width + 14;
        ctx.fillStyle = C.fg; ctx.fillRect(Math.min(this.plotW - tw, Math.max(0, X - tw / 2)), this.timeY + 2, tw, 19);
        ctx.fillStyle = C.bg; ctx.fillText(tl, Math.min(this.plotW - tw, Math.max(0, X - tw / 2)) + 7, this.timeY + 15); ctx.font = '11px system-ui, sans-serif';
      }
      // legend
      const k = d[i], prev = d[i - 1], ch = prev ? (k.c / prev.c - 1) * 100 : 0, col = ch >= 0 ? C.up : C.down;
      const parts = [`<b>${fmtTime(k.t, this.step)}</b>`,
        `O <b>${fmtPrice(k.o)}</b> H <b>${fmtPrice(k.h)}</b> L <b>${fmtPrice(k.l)}</b> C <b style="color:${col}">${fmtPrice(k.c)}</b> <span style="color:${col}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>${this.opts.hasVolume && k.v != null ? ` · Vol <b>${k.v.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>` : ''}`];
      const ov = [];
      this.ind.ema.forEach((e, j) => this.calc.ema[j] && ov.push(`<span style="color:${e.color}">EMA ${e.period} <b>${fmtPrice(this.calc.ema[j][i])}</b></span>`));
      this.ind.sma.forEach((e, j) => this.calc.sma[j] && ov.push(`<span style="color:${e.color}">SMA ${e.period} <b>${fmtPrice(this.calc.sma[j][i])}</b></span>`));
      if (this.calc.bb) ov.push(`<span style="color:${this.ind.bb.color}">BB ${this.ind.bb.period} ${this.ind.bb.mult} <b>${fmtPrice(this.calc.bb.up[i])}</b> / <b>${fmtPrice(this.calc.bb.lo[i])}</b></span>`);
      if (this.calc.rsi) ov.push(`RSI <b>${this.calc.rsi[i] == null ? '—' : this.calc.rsi[i].toFixed(1)}</b>`);
      if (this.calc.macd) ov.push(`MACD <b>${this.calc.macd.line[i] == null ? '—' : fmtPrice(this.calc.macd.line[i])}</b>`);
      if (ov.length) parts.push(ov.join(' &nbsp;'));
      this.legend.innerHTML = parts.join('<br>');
    }

    // ---------- interaction ----------
    pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    // Snap a pixel position to the nearest candle's O/H/L/C (if magnet is on and close enough).
    snapPoint(px, py) {
      const d = this.data;
      let idx = this.idxAt(px), p = this.priceAt(py), snapped = false;
      if (this.magnet && d.length) {
        const i = Math.max(0, Math.min(d.length - 1, Math.round(idx)));
        if (Math.abs(this.x(i) - px) < Math.max(14, this.barW)) {
          const k = d[i];
          const cands = (this.type === 'candles' ? [k.o, k.h, k.l, k.c] : [k.c]);
          // also snap to other drawings' points
          let best = null, bestD = 22;
          cands.forEach((v) => { const dd = Math.abs(this.y(v) - py); if (dd < bestD) { bestD = dd; best = v; } });
          if (best != null) { idx = i; p = best; snapped = true; }
        }
        this.drawings.forEach((dr) => [dr.p1, dr.p2].forEach((q) => {
          if (!q) return;
          const qx = this.x(this.tToIdx(q.t)), qy = this.y(q.p);
          if (Math.hypot(qx - px, qy - py) < 10) { idx = this.tToIdx(q.t); p = q.p; snapped = true; }
        }));
      }
      return { t: this.idxToT(idx), p, snapped };
    }

    hitDrawing(px, py) {
      for (let j = this.drawings.length - 1; j >= 0; j--) {
        const dr = this.drawings[j], { p1, p2 } = this.drawingPx(dr);
        if (dr.type === 'hline') { if (Math.abs(py - p1.y) < 7) return { j, part: 'line' }; continue; }
        if (Math.hypot(px - p1.x, py - p1.y) < 8) return { j, part: 'p1' };
        if (p2 && Math.hypot(px - p2.x, py - p2.y) < 8) return { j, part: 'p2' };
        if (p2 && distToSeg(px, py, p1.x, p1.y, p2.x, p2.y, dr.type === 'ray') < 7) return { j, part: 'line' };
      }
      return null;
    }

    onWheel(e) {
      if (!this.data.length) return;
      const { x } = this.pos(e), mx = Math.min(x, this.plotW);
      const at = this.idxAt(mx);
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.barW = Math.max(1.5, Math.min(48, this.barW * f));
      this.end = at + (this.plotW - mx) / this.barW;
      this.draw();
    }

    onDown(e) {
      if (!this.data.length) return;
      const pt = this.pos(e); try { this.cv.setPointerCapture(e.pointerId); } catch { /* synthetic or released pointer */ }
      this.ptrs = this.ptrs || new Map(); this.ptrs.set(e.pointerId, pt);
      if (this.ptrs.size === 2) { // start pinch-zoom
        const [a, b] = [...this.ptrs.values()];
        const mid = Math.min((a.x + b.x) / 2, this.plotW);
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, barW0: this.barW, at: this.idxAt(mid), mid };
        this.drag = null; this.pending = null; return;
      }
      if (e.pointerType === 'touch') {
        this.mouse = pt;
        const now = Date.now(), lt = this.lastTap;
        if (lt && now - lt.t < 320 && Math.hypot(pt.x - lt.x, pt.y - lt.y) < 30 && this.tool === 'cursor') { this.lastTap = null; this.resetView(); return; }
        this.lastTap = { t: now, x: pt.x, y: pt.y };
      }
      const inMain = pt.y <= this.panes.main.top + this.panes.main.h && pt.x < this.plotW;
      if (this.tool !== 'cursor' && inMain) {
        const sp = this.snapPoint(pt.x, pt.y);
        if (this.tool === 'hline') { this.drawings.push({ type: 'hline', p1: { t: sp.t, p: sp.p } }); this.afterAdd(); return; }
        if (!this.pending) { this.pending = { type: this.tool, p1: { t: sp.t, p: sp.p } }; }
        else {
          this.drawings.push({ type: this.pending.type, p1: this.pending.p1, p2: { t: sp.t, p: sp.p } });
          this.pending = null; this.afterAdd();
        }
        this.draw(); return;
      }
      const hit = inMain ? this.hitDrawing(pt.x, pt.y) : null;
      if (hit) {
        this.sel = hit.j;
        const dr = this.drawings[hit.j];
        this.drag = { kind: 'drawing', part: hit.part, start: pt, orig: JSON.parse(JSON.stringify(dr)) };
      } else {
        this.sel = -1;
        this.drag = { kind: 'pan', start: pt, end0: this.end };
      }
      this.draw();
    }

    afterAdd() {
      this.sel = this.drawings.length - 1; this.saveDrawings();
      this.tool = 'cursor'; this.syncBar(); this.draw();
    }

    onMove(e) {
      const pt = this.pos(e);
      if (this.ptrs && this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, pt);
      if (this.pinch && this.ptrs && this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.barW = Math.max(1.5, Math.min(48, this.pinch.barW0 * d / this.pinch.d0));
        this.end = this.pinch.at + (this.plotW - this.pinch.mid) / this.barW;
        this.draw(); return;
      }
      if (e.pointerType === 'touch' && !this.ptrs?.has(e.pointerId)) return;
      this.mouse = pt;
      if (this.drag && this.drag.kind === 'pan') {
        this.end = this.drag.end0 - (pt.x - this.drag.start.x) / this.barW;
      } else if (this.drag && this.drag.kind === 'drawing') {
        const dr = this.drawings[this.sel], o = this.drag.orig;
        if (this.drag.part === 'p1' || this.drag.part === 'p2') {
          const sp = this.snapPoint(pt.x, pt.y); dr[this.drag.part] = { t: sp.t, p: sp.p };
        } else {
          // move whole drawing by the pointer offset
          const di = (pt.x - this.drag.start.x) / this.barW, dp = this.priceAt(pt.y) - this.priceAt(this.drag.start.y);
          const mv = (q) => q && { t: this.idxToT(this.tToIdx(q.t) + di), p: q.p + dp };
          dr.p1 = mv(o.p1); if (o.p2) dr.p2 = mv(o.p2);
        }
      } else if (this.tool === 'cursor') {
        const hit = pt.x < this.plotW ? this.hitDrawing(pt.x, pt.y) : null;
        this.cv.style.cursor = hit ? (hit.part === 'line' ? 'move' : 'pointer') : 'default';
      }
      this.draw();
    }

    onUp(e) {
      if (this.ptrs) this.ptrs.delete(e.pointerId);
      if (this.pinch) { if (!this.ptrs || this.ptrs.size === 0) this.pinch = null; return; }
      if (this.drag && this.drag.kind === 'drawing') this.saveDrawings();
      this.drag = null;
    }

    // ---------- indicator panel ----------
    togglePanel() {
      const old = this.root.querySelector('.xc-pop');
      if (old) { old.remove(); return; }
      const pop = document.createElement('div'); pop.className = 'xc-pop';
      this.root.appendChild(pop); this.renderPanel(pop);
      const close = (e) => { if (!pop.contains(e.target) && !e.target.closest('[data-act=ind]')) { pop.remove(); document.removeEventListener('pointerdown', close); } };
      setTimeout(() => document.addEventListener('pointerdown', close), 0);
    }

    renderPanel(pop) {
      const I = this.ind;
      const maRows = (kind) => I[kind].map((m, j) => `
        <div class="xc-row"><input type="checkbox" data-k="${kind}.${j}.on" ${m.on ? 'checked' : ''}>
          <label>${kind.toUpperCase()}</label>
          <input type="number" min="1" max="500" data-k="${kind}.${j}.period" value="${m.period}">
          <input type="color" data-k="${kind}.${j}.color" value="${m.color}">
          <button class="x" data-del="${kind}.${j}" title="Remove">✕</button></div>`).join('');
      pop.innerHTML = `
        <h4>Moving averages</h4>
        ${maRows('ema')}<button class="xc-add" data-addma="ema">+ Add EMA</button>
        ${maRows('sma')}<button class="xc-add" data-addma="sma">+ Add SMA</button>
        <h4>Bollinger Bands</h4>
        <div class="xc-row"><input type="checkbox" data-k="bb.on" ${I.bb.on ? 'checked' : ''}><label>Length / width</label>
          <input type="number" min="2" max="500" data-k="bb.period" value="${I.bb.period}">
          <input type="number" min="0.5" max="5" step="0.5" data-k="bb.mult" value="${I.bb.mult}">
          <input type="color" data-k="bb.color" value="${I.bb.color}"></div>
        <h4>Panels</h4>
        ${this.opts.hasVolume ? `<div class="xc-row"><input type="checkbox" data-k="volume.on" ${I.volume.on ? 'checked' : ''}><label>Volume</label></div>` : ''}
        <div class="xc-row"><input type="checkbox" data-k="rsi.on" ${I.rsi.on ? 'checked' : ''}><label>RSI length</label>
          <input type="number" min="2" max="200" data-k="rsi.period" value="${I.rsi.period}"></div>
        <div class="xc-row"><input type="checkbox" data-k="macd.on" ${I.macd.on ? 'checked' : ''}><label>MACD</label>
          <input type="number" min="1" max="200" data-k="macd.fast" value="${I.macd.fast}" title="Fast">
          <input type="number" min="1" max="200" data-k="macd.slow" value="${I.macd.slow}" title="Slow">
          <input type="number" min="1" max="200" data-k="macd.signal" value="${I.macd.signal}" title="Signal"></div>
        <div class="xc-row" style="margin-top:12px"><button class="xc-add" data-reset="1">Reset to defaults</button></div>`;
      const setPath = (path, val) => {
        const ks = path.split('.'); let o = I;
        for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
        o[ks[ks.length - 1]] = val;
      };
      pop.oninput = (e) => {
        const el = e.target, k = el.dataset.k; if (!k) return;
        if (el.type === 'checkbox') setPath(k, el.checked);
        else if (el.type === 'number') { const v = parseFloat(el.value); if (!(v > 0)) return; setPath(k, v); }
        else setPath(k, el.value);
        this.saveInd();
      };
      pop.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.addma) {
          const palette = ['#ef4444', '#10b981', '#ec4899', '#0ea5e9', '#84cc16', '#f97316'];
          I[b.dataset.addma].push({ on: true, period: b.dataset.addma === 'ema' ? 100 : 20, color: palette[(I.ema.length + I.sma.length) % palette.length] });
        } else if (b.dataset.del) { const [kind, j] = b.dataset.del.split('.'); I[kind].splice(+j, 1); }
        else if (b.dataset.reset) { this.ind = JSON.parse(JSON.stringify(DEFAULT_IND)); }
        else return;
        this.saveInd(); this.renderPanel(pop);
      };
    }
  }

  window.XChart = XChart;
  window.XChartMath = { sma, ema, bollinger, rsi, macd };
})();
