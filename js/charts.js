'use strict';
/* =====================================================================
   FraudShield AI — tiny dependency-free canvas chart library
   (bars, lines, donut, gauge, horizontal bars) — theme-aware via CSS vars
   ===================================================================== */

const Charts = (() => {
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w < 20 || h < 20) return null; // canvas is hidden (inactive view)
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = `500 11px ${css('--font')}`;
    return { ctx, w, h };
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, [r, r, 0, 0]); else ctx.rect(x, y, w, h);
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  const short = v => (v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1000 ? (v / 1000).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(+v.toFixed(2)));

  function yGrid(ctx, pad, w, ph, max, fmt = short) {
    ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(pad.t + ph - (ph * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmt((max * i) / 4), pad.l - 8, y);
    }
  }

  /** Grouped vertical bars. series: [{values, color, label}] */
  function bars(cv, labels, series, { yFmt } = {}) {
    const S = setup(cv); if (!S) return;
    const { ctx, w, h } = S;
    const pad = { l: 40, r: 8, t: 12, b: 24 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
    yGrid(ctx, pad, w, ph, max, yFmt);
    const gw = pw / labels.length;
    const bw = Math.max(2, Math.min(16, (gw * 0.72) / series.length));
    const every = Math.ceil(labels.length / Math.max(1, Math.floor(pw / 36)));
    labels.forEach((lab, i) => {
      series.forEach((s, k) => {
        const bh = (ph * s.values[i]) / max;
        const x = pad.l + gw * i + gw / 2 - (bw * series.length) / 2 + k * bw;
        ctx.fillStyle = s.color;
        rr(ctx, x + 0.5, pad.t + ph - bh, bw - 1.5, bh, 4);
        ctx.fill();
      });
      if (i % every === 0) {
        ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(lab, pad.l + gw * i + gw / 2, pad.t + ph + 7);
      }
    });
  }

  /** Line chart. series: [{pts:[[x,y]], color, fill, dash, width}] */
  function line(cv, series, { xMax = 1, yMax = 1, xFmt = short, yFmt = short, diagonal = false, xTicks = 5, hLine = null } = {}) {
    const S = setup(cv); if (!S) return;
    const { ctx, w, h } = S;
    const pad = { l: 40, r: 12, t: 12, b: 24 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    yGrid(ctx, pad, w, ph, yMax, yFmt);
    const X = x => pad.l + (x / xMax) * pw, Y = y => pad.t + ph - (y / yMax) * ph;
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) ctx.fillText(xFmt((xMax * i) / xTicks), X((xMax * i) / xTicks), pad.t + ph + 7);
    if (diagonal) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = css('--muted'); ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(xMax), Y(yMax)); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (hLine != null) {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = css('--high'); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(hLine)); ctx.lineTo(w - pad.r, Y(hLine)); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of series) {
      if (!s.pts.length) continue;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (s.fill) {
        ctx.save();
        ctx.lineTo(X(s.pts[s.pts.length - 1][0]), Y(0)); ctx.lineTo(X(s.pts[0][0]), Y(0)); ctx.closePath();
        const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
        g.addColorStop(0, s.color + '55'); g.addColorStop(1, s.color + '00');
        ctx.fillStyle = g; ctx.fill(); ctx.restore();
        ctx.beginPath();
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2.5; ctx.lineJoin = 'round';
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /** Donut. segments: [{label, value, color}] */
  function donut(cv, segments, center = '', sub = '') {
    const S = setup(cv); if (!S) return;
    const { ctx, w, h } = S;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8, lw = Math.max(14, R * 0.3);
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    ctx.lineWidth = lw; ctx.strokeStyle = css('--track');
    ctx.beginPath(); ctx.arc(cx, cy, R - lw / 2, 0, Math.PI * 2); ctx.stroke();
    let a = -Math.PI / 2;
    for (const s of segments) {
      const da = (s.value / total) * Math.PI * 2;
      if (da <= 0) continue;
      ctx.strokeStyle = s.color;
      ctx.beginPath(); ctx.arc(cx, cy, R - lw / 2, a + 0.02, a + da - 0.02); ctx.stroke();
      a += da;
    }
    ctx.fillStyle = css('--text'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(R * 0.32)}px ${css('--font')}`;
    ctx.fillText(center, cx, cy - 6);
    ctx.font = `500 11px ${css('--font')}`; ctx.fillStyle = css('--muted');
    ctx.fillText(sub, cx, cy + R * 0.24);
  }

  /** Semi-circular risk gauge, v in 0..1 */
  function gauge(cv, v, label = 'RISK SCORE') {
    const S = setup(cv); if (!S) return;
    const { ctx, w, h } = S;
    const lw = 18, R = Math.min(w / 2 - lw, h - lw - 10), cx = w / 2, cy = h - 12;
    ctx.lineCap = 'round'; ctx.lineWidth = lw;
    ctx.strokeStyle = css('--track');
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI); ctx.stroke();
    const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    g.addColorStop(0, css('--low')); g.addColorStop(0.5, css('--med')); g.addColorStop(1, css('--high'));
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, Math.PI + Math.PI * Math.max(0.001, v)); ctx.stroke();
    const ang = Math.PI + Math.PI * v, kx = cx + R * Math.cos(ang), ky = cy + R * Math.sin(ang);
    ctx.fillStyle = css('--bg'); ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(kx, ky, lw / 2 + 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = css('--text'); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(R * 0.42)}px ${css('--font')}`;
    ctx.fillText(Math.round(v * 100), cx, cy - R * 0.22);
    ctx.font = `600 10px ${css('--font')}`; ctx.fillStyle = css('--muted');
    ctx.fillText(label, cx, cy - 2);
  }

  /** Horizontal bars; signed=true draws a centre axis (for feature contributions) */
  function hbars(cv, labels, values, { signed = false, color, fmt = v => v.toFixed(2) } = {}) {
    const S = setup(cv); if (!S) return;
    const { ctx, w, h } = S;
    const labelW = Math.min(170, w * 0.42), pad = { l: labelW, r: 44, t: 4, b: 4 };
    const rowH = (h - pad.t - pad.b) / labels.length, bh = Math.min(16, rowH * 0.6);
    const max = Math.max(1e-6, ...values.map(Math.abs));
    const pw = w - pad.l - pad.r, zero = signed ? pad.l + pw / 2 : pad.l;
    const scale = signed ? pw / 2 / max : pw / max;
    if (signed) {
      ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(zero, pad.t); ctx.lineTo(zero, h - pad.b); ctx.stroke();
    }
    labels.forEach((lab, i) => {
      const v = values[i], y = pad.t + rowH * i + rowH / 2;
      ctx.fillStyle = css('--text'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(lab, pad.l - 10, y);
      ctx.fillStyle = css('--track');
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(pad.l, y - bh / 2, pw, bh, bh / 2) : ctx.rect(pad.l, y - bh / 2, pw, bh); ctx.fill();
      const len = Math.abs(v) * scale, x = v >= 0 ? zero : zero - len;
      ctx.fillStyle = color || (v >= 0 ? css('--high') : css('--low'));
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - bh / 2, Math.max(2, len), bh, bh / 2) : ctx.rect(x, y - bh / 2, Math.max(2, len), bh); ctx.fill();
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'left';
      ctx.fillText(fmt(v), w - pad.r + 6, y);
    });
  }

  return { bars, line, donut, gauge, hbars, css };
})();
