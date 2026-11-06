'use strict';
/* =====================================================================
   FraudShield AI — UI controller
   ===================================================================== */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = v => INR.format(v);
const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const css = Charts.css;
const fmtTime = t => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtClock = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

const App = {
  data: null, ml: null, threshold: 0.5, view: 'dashboard',
  reviews: new Map(),
  live: [], liveRisks: [], timer: null, speed: 1400, stream: null,
  lv: { total: 0, approve: 0, review: 0, block: 0 },
  tx: { page: 1, per: 12, q: '', decision: 'all', category: 'all', sort: 'time' },
  batch: null,
  opts: { seed: 42, customers: 250, trees: 100 },
  modalTx: null,
};

const VIEWS = {
  dashboard: ['Fraud Overview', 'AI-scored activity across all customer accounts'],
  monitor: ['Live Monitor', 'Real-time transaction stream scored by the AI engine'],
  analyzer: ['Transaction Analyzer', 'Score any transaction and see why the AI decided'],
  transactions: ['Transactions', 'Search, filter and review every scored transaction'],
  batch: ['Batch Scan', 'Upload a CSV file and screen it for fraud in bulk'],
  model: ['AI Model Lab', 'Performance, explainability and retraining'],
  about: ['How It Works', 'Features, functionality and benefits of FraudShield AI'],
};

/* ---------------- decisions & explanations ---------------- */
const DECISION = {
  approve: { label: 'Approve', cls: 'low' },
  review: { label: 'Review', cls: 'med' },
  block: { label: 'Block', cls: 'high' },
};
function decide(risk) {
  if (risk >= App.threshold) return 'block';
  if (risk >= App.threshold * 0.55) return 'review';
  return 'approve';
}
const badge = (d, big = false) => `<span class="badge ${DECISION[d].cls}${big ? ' big' : ''}">${DECISION[d].label}</span>`;
const riskColor = r => `var(--${DECISION[decide(r)].cls})`;
const riskCell = r => `<div class="risk"><div class="riskbar"><i style="width:${Math.max(3, Math.round(r * 100))}%;background:${riskColor(r)}"></i></div><span class="risk-num">${Math.round(r * 100)}</span></div>`;

function score(tx) {
  const s = App.ml.model.score(tx.x);
  tx.risk = s.risk; tx.p = s.p; tx.a = s.a;
  return tx;
}

/** Converts raw context + model contributions into plain-English reason codes */
function explain(raw, contrib) {
  const items = [];
  const add = (fi, text) => items.push({ text, weight: contrib ? contrib[fi] : 1 });
  if (raw.amountRatio >= 2.5) add(1, `Amount is ${raw.amountRatio.toFixed(1)}× this customer's average spend (${money(raw.avgSpend)})`);
  if (raw.hour <= 5) add(3, `Made at ${String(raw.hour).padStart(2, '0')}:00 — unusual night-time activity`);
  else if (raw.hourDev >= 5) add(2, `${raw.hourDev} h away from the customer's usual activity time`);
  if (raw.newDevice) add(6, 'Unrecognised device — first time this fingerprint is seen');
  if (raw.foreign) add(5, 'International location for a domestic customer');
  else if (raw.distanceKm >= 300) add(4, `${raw.distanceKm.toLocaleString('en-IN')} km away from the customer's home city`);
  if (raw.velocity >= 2) add(7, `${raw.velocity} other transactions in the past hour (velocity spike)`);
  if (raw.minsSince < 10) add(8, `Only ${Math.round(raw.minsSince)} min since the previous transaction`);
  if (raw.catRisk >= 0.6) add(9, `High-risk merchant category: ${raw.category}`);
  if (raw.online && raw.amountRatio >= 2) add(10, 'Card-not-present (online) payment for a large amount');
  items.sort((a, b) => b.weight - a.weight);
  if (!items.length) items.push({ text: 'Behaviour matches the customer’s normal spending profile', ok: true });
  return items;
}
const reasonsHTML = items => items.slice(0, 5).map(r =>
  `<li class="${r.ok ? 'ok' : ''}">${icon(r.ok ? 'check' : 'alert')}<span>${esc(r.text)}</span></li>`).join('');

function drawContrib(cv, x) {
  const c = App.ml.model.lr.contributions(x);
  const order = c.map((v, j) => j).sort((a, b) => Math.abs(c[b]) - Math.abs(c[a])).slice(0, 7);
  Charts.hbars(cv, order.map(j => DATA.FEATURES[j].label), order.map(j => c[j]), { signed: true, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) });
}

/* ---------------- UI helpers ---------------- */
function toast(msg, kind = '', ic = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = icon(ic) + `<span>${msg}</span>`;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3600);
}
function setLoader(text) { $('#loaderText').textContent = text; $('#loader').classList.remove('hide'); }
function hideLoader() { $('#loader').classList.add('hide'); }

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- navigation ---------------- */
function go(view) {
  App.view = view;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $('#viewTitle').textContent = VIEWS[view][0];
  $('#viewSub').textContent = VIEWS[view][1];
  closeMenu();
  window.scrollTo({ top: 0 });
  render();
}
function render() {
  if (!App.ml) return;
  $('#thrChip').textContent = App.threshold.toFixed(2);
  ({ dashboard: renderDashboard, monitor: renderMonitor, analyzer: renderAnalyzer, transactions: renderTransactions,
    batch: renderBatch, model: renderModel, about: () => {} })[App.view]();
}
function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

/* ================= DASHBOARD ================= */
function renderDashboard() {
  const txns = App.data.txns;
  const dec = txns.map(t => decide(t.risk));
  const blocked = txns.filter((t, i) => dec[i] === 'block');
  const reviewN = dec.filter(d => d === 'review').length;
  const frauds = txns.filter(t => t.isFraud);
  const caught = blocked.filter(t => t.isFraud);
  const m = ML.metricsAt(App.ml.test.risk, App.ml.test.y, App.threshold);

  $('#kTotal').textContent = txns.length.toLocaleString('en-IN');
  $('#kTotalSub').textContent = `${App.data.customers.length} customers · ${App.data.days} days`;
  $('#kBlocked').textContent = blocked.length.toLocaleString('en-IN');
  $('#kBlockedSub').textContent = `${reviewN} more sent for manual review`;
  $('#kRecall').textContent = pct(m.recall);
  $('#kRecallSub').textContent = `Precision ${pct(m.precision)} on unseen data`;
  $('#kSaved').textContent = money(caught.reduce((a, t) => a + t.amount, 0));
  $('#kSavedSub').textContent = `${caught.length} of ${frauds.length} fraud attempts stopped`;

  // daily flagged
  const days = App.data.days, bD = new Array(days).fill(0), rD = new Array(days).fill(0);
  txns.forEach((t, i) => {
    const d = Math.floor((t.time - App.data.start) / 86400000);
    if (d < 0 || d >= days) return;
    if (dec[i] === 'block') bD[d]++; else if (dec[i] === 'review') rD[d]++;
  });
  const labels = bD.map((_, d) => new Date(App.data.start + d * 86400000).getDate() + '');
  Charts.bars($('#chDaily'), labels, [{ values: bD, color: css('--high') }, { values: rD, color: css('--med') }]);

  // category donut
  const byCat = {};
  blocked.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + 1; });
  let segs = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (segs.length > 5) segs = [...segs.slice(0, 5), ['Other', segs.slice(5).reduce((a, s) => a + s[1], 0)]];
  const palette = [css('--high'), css('--accent'), css('--med'), css('--accent2'), css('--low'), css('--legit')];
  const segments = segs.map(([label, value], i) => ({ label, value, color: palette[i] }));
  Charts.donut($('#chCat'), segments, String(blocked.length), 'blocked');
  $('#lgCat').innerHTML = segments.map(s =>
    `<li><span><i style="background:${s.color}"></i>${esc(s.label)}</span><b>${pct(s.value / Math.max(1, blocked.length), 0)}</b></li>`).join('')
    || '<li class="muted">No blocked transactions</li>';

  // hourly
  const hr = new Array(24).fill(0);
  txns.forEach((t, i) => { if (dec[i] !== 'approve') hr[t.raw.hour]++; });
  Charts.bars($('#chHour'), hr.map((_, h) => String(h).padStart(2, '0')), [{ values: hr, color: css('--accent') }]);

  // alerts
  const latest = blocked.slice(-7).reverse();
  $('#alertList').innerHTML = latest.map(t => alertItem(t)).join('') || '<li class="empty">No alerts at this threshold</li>';
  bindTxClicks($('#alertList'), latest);

  renderInsights(txns, dec, blocked);
}
function alertItem(t) {
  const d = decide(t.risk);
  return `<li data-i>
    <div class="av ${DECISION[d].cls}">${Math.round(t.risk * 100)}</div>
    <div class="li-main"><b>${esc(t.customer)} · ${esc(t.category)}</b><small>${esc(t.city)} · ${fmtTime(t.time)} · ${t.online ? 'Online' : 'In-store'}</small></div>
    <div class="li-amt">${money(t.amount)}<small>${badge(d)}</small></div></li>`;
}
function bindTxClicks(root, list) {
  [...root.children].forEach((li, i) => { if (list[i]) li.onclick = () => openTx(list[i]); });
}
function renderInsights(txns, dec, blocked) {
  const B = Math.max(1, blocked.length);
  const nightB = blocked.filter(t => t.raw.hour <= 5).length / B;
  const nightAll = txns.filter(t => t.raw.hour <= 5).length / txns.length;
  const foreignAll = txns.filter(t => t.raw.foreign), foreignB = foreignAll.filter(t => decide(t.risk) === 'block');
  const domAll = txns.filter(t => !t.raw.foreign), domB = domAll.filter(t => decide(t.risk) === 'block');
  const devB = blocked.filter(t => t.raw.newDevice).length / B;
  const avgB = blocked.reduce((a, t) => a + t.amount, 0) / B;
  const approved = txns.filter((t, i) => dec[i] === 'approve');
  const avgA = approved.reduce((a, t) => a + t.amount, 0) / Math.max(1, approved.length);
  const velB = blocked.filter(t => t.raw.velocity >= 2).length / B;
  const cats = {};
  txns.forEach((t, i) => { const c = cats[t.category] ||= { n: 0, b: 0 }; c.n++; if (dec[i] === 'block') c.b++; });
  const [topCat, tc] = Object.entries(cats).filter(([, c]) => c.n >= 20).sort((a, b) => b[1].b / b[1].n - a[1].b / a[1].n)[0] || ['—', { n: 1, b: 0 }];
  const fRate = foreignB.length / Math.max(1, foreignAll.length), dRate = domB.length / Math.max(1, domAll.length);

  const cards = [
    ['moon2', pct(nightB, 0), `of blocked payments happened between 00:00–05:00, although only ${pct(nightAll, 0)} of all activity is at night.`],
    ['tag', topCat, `is the riskiest merchant category — ${pct(tc.b / tc.n, 0)} of its transactions are blocked.`],
    ['globe', fRate && dRate ? `${(fRate / Math.max(dRate, 1e-4)).toFixed(0)}×` : '—', `higher block rate for international transactions (${pct(fRate, 0)}) than domestic ones (${pct(dRate, 1)}).`],
    ['phone', pct(devB, 0), 'of blocked transactions came from a device the customer had never used before.'],
    ['rupee', `${(avgB / Math.max(1, avgA)).toFixed(1)}×`, `larger on average: blocked payments average ${money(avgB)} vs ${money(avgA)} for approved ones.`],
    ['bolt', pct(velB, 0), 'of blocked payments were part of a rapid burst (2+ payments in the same hour).'],
  ];
  $('#insights').innerHTML = cards.map(([ic, big, text]) =>
    `<div class="insight">${icon(ic)}<div><b>${esc(big)}</b><p>${esc(text)}</p></div></div>`).join('');
}

/* ================= LIVE MONITOR ================= */
function renderMonitor() {
  $('#lvTotal').textContent = App.lv.total;
  $('#lvApprove').textContent = App.lv.approve;
  $('#lvReview').textContent = App.lv.review;
  $('#lvBlock').textContent = App.lv.block;
  Charts.line($('#chLive'), [{ pts: App.liveRisks.map((r, i) => [i, r]), color: css('--accent'), fill: true }],
    { xMax: 59, yMax: 1, xFmt: v => '', yFmt: v => Math.round(v * 100), hLine: App.threshold, xTicks: 1 });
}
function liveTick() {
  const tx = score(App.stream.next());
  const d = decide(tx.risk);
  App.lv.total++; App.lv[d]++;
  App.live.unshift(tx);
  if (App.live.length > 60) App.live.pop();
  App.liveRisks.push(tx.risk);
  if (App.liveRisks.length > 60) App.liveRisks.shift();
  $('#liveClock').textContent = fmtClock(tx.time);

  const feed = $('#feed');
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = d === 'block' ? 'flash' : 'new';
  li.innerHTML = `<div class="av ${DECISION[d].cls}">${Math.round(tx.risk * 100)}</div>
    <div class="li-main"><b>${esc(tx.customer)} · ${esc(tx.category)}</b><small>${tx.id} · ${fmtClock(tx.time)} · ${esc(tx.city)} · ${tx.online ? 'Online' : 'In-store'}</small></div>
    <div class="li-amt">${money(tx.amount)}<small>${badge(d)}</small></div>`;
  li.onclick = () => openTx(tx);
  feed.prepend(li);
  while (feed.children.length > 40) feed.lastChild.remove();
  if (d === 'block') toast(`Blocked ${money(tx.amount)} · ${esc(tx.category)} for ${esc(tx.customer)}`, 'high', 'alert');
  if (App.view === 'monitor') renderMonitor();
}
function setLive(on) {
  clearInterval(App.timer);
  App.timer = on ? setInterval(liveTick, App.speed) : null;
  $('#liveToggle').innerHTML = on ? `${icon('pause')}<span>Pause stream</span>` : `${icon('play')}<span>Start stream</span>`;
  $('#navLive').classList.toggle('on', on);
}

/* ================= ANALYZER ================= */
function populateAnalyzer() {
  const cs = App.data.customers.slice(0, 80);
  $('#anCustomer').innerHTML = cs.map(c => `<option value="${c.id}">${c.id} · ${esc(c.name)} (${c.home.name})</option>`).join('');
  $('#anCategory').innerHTML = DATA.CATEGORIES.map(c => `<option>${c.name}</option>`).join('');
  $('#anCity').innerHTML = `<optgroup label="India">${DATA.CITIES.map(c => `<option>${c.name}</option>`).join('')}</optgroup>
    <optgroup label="International">${DATA.FOREIGN.map(c => `<option>${c.name}</option>`).join('')}</optgroup>`;
  applyPreset('normal');
}
const segVal = id => +$(`#${id} .on`).dataset.v;
function setSeg(id, v) { $$(`#${id} button`).forEach(b => b.classList.toggle('on', +b.dataset.v === v)); }
function anCustomer() { return App.data.customers.find(c => c.id === $('#anCustomer').value) || App.data.customers[0]; }

function applyPreset(name) {
  const c = anCustomer();
  const P = {
    normal: { amount: Math.round(c.avgSpend * 1.1), cat: DATA.CATEGORIES[c.fav[0]].name, city: c.home.name, hour: c.usualHour, online: 0, dev: 0, vel: 0, rec: 600 },
    ato: { amount: Math.round(c.avgSpend * 9), cat: 'Electronics', city: 'Dubai', hour: 2, online: 1, dev: 1, vel: 2, rec: 6 },
    testing: { amount: 49, cat: 'Gift Cards', city: c.home.name, hour: 3, online: 1, dev: 1, vel: 5, rec: 2 },
    stolen: { amount: Math.round(c.avgSpend * 5), cat: 'Jewellery', city: DATA.CITIES.find(x => x !== c.home).name, hour: 16, online: 0, dev: 0, vel: 1, rec: 25 },
  }[name];
  $('#anAmount').value = P.amount; $('#anCategory').value = P.cat; $('#anCity').value = P.city;
  $('#anHour').value = P.hour; setSeg('anChannel', P.online); setSeg('anDevice', P.dev);
  $('#anVelocity').value = P.vel; $('#anRecency').value = P.rec;
  $$('.chip-btn').forEach(b => b.classList.toggle('on', b.dataset.preset === name));
  renderAnalyzer();
}
function analyzerRaw() {
  const c = anCustomer(), city = DATA.cityByName($('#anCity').value);
  const online = segVal('anChannel'), hour = +$('#anHour').value, amount = Math.max(1, +$('#anAmount').value || 1);
  $$('#anDevice button').forEach(b => { b.disabled = !online; });
  const category = $('#anCategory').value;
  return {
    amount, avgSpend: c.avgSpend, amountRatio: amount / c.avgSpend, hour, usualHour: c.usualHour,
    hourDev: DATA.circ(hour, c.usualHour), distanceKm: Math.round(DATA.haversine(c.home, city)),
    foreign: city.foreign ? 1 : 0, newDevice: online && segVal('anDevice') ? 1 : 0, online,
    velocity: Math.max(0, +$('#anVelocity').value || 0), minsSince: Math.max(0, +$('#anRecency').value || 0),
    catRisk: DATA.CAT_RISK[category], category,
  };
}
function renderAnalyzer() {
  const c = anCustomer();
  $('#anProfile').innerHTML = `<span>Home <b>${c.home.name}</b></span><span>Avg spend <b>${money(c.avgSpend)}</b></span>
    <span>Usually active <b>~${String(c.usualHour).padStart(2, '0')}:00</b></span>`;
  $('#anHourOut').textContent = String($('#anHour').value).padStart(2, '0') + ':00';
  const raw = analyzerRaw(), x = DATA.featurize(raw), s = App.ml.model.score(x), d = decide(s.risk);
  Charts.gauge($('#anGauge'), s.risk);
  $('#anBadge').innerHTML = badge(d, true);
  $('#anP').textContent = pct(s.p, 0);
  $('#anA').textContent = pct(s.a, 0);
  $('#anReasons').innerHTML = reasonsHTML(explain(raw, App.ml.model.lr.contributions(x)));
  drawContrib($('#anContrib'), x);
}

/* ================= TRANSACTIONS ================= */
function populateTxFilters() {
  $('#txCategory').innerHTML = '<option value="all">All categories</option>' + DATA.CATEGORIES.map(c => `<option>${c.name}</option>`).join('');
}
function filteredTx() {
  const { q, decision, category, sort } = App.tx, ql = q.trim().toLowerCase();
  let list = App.data.txns.filter(t =>
    (decision === 'all' || decide(t.risk) === decision) &&
    (category === 'all' || t.category === category) &&
    (!ql || t.id.toLowerCase().includes(ql) || t.customer.toLowerCase().includes(ql) || t.city.toLowerCase().includes(ql) || t.customerId.toLowerCase().includes(ql)));
  const key = { time: t => -t.time, risk: t => -t.risk, amount: t => -t.amount }[sort];
  return list.sort((a, b) => key(a) - key(b));
}
function reviewTag(t) {
  const r = App.reviews.get(t.id);
  return r ? `<span class="tag reviewed">${r === 'fraud' ? 'Confirmed fraud' : 'Marked safe'}</span>` : '';
}
function renderTransactions() {
  const list = filteredTx(), per = App.tx.per, pages = Math.max(1, Math.ceil(list.length / per));
  App.tx.page = Math.min(App.tx.page, pages);
  const rows = list.slice((App.tx.page - 1) * per, App.tx.page * per);
  $('#txCount').textContent = `${list.length.toLocaleString('en-IN')} results`;
  $('#txBody').innerHTML = rows.map(t => `<tr>
      <td class="id">${t.id}</td><td>${fmtTime(t.time)}</td>
      <td>${esc(t.customer)}<br><small class="muted">${t.customerId}</small></td>
      <td class="num">${money(t.amount)}</td><td>${esc(t.category)}</td>
      <td>${esc(t.city)}${t.foreign ? ' 🌐' : ''}</td><td>${t.online ? 'Online' : 'In-store'}</td>
      <td>${riskCell(t.risk)}</td><td>${badge(decide(t.risk))}${reviewTag(t)}</td></tr>`).join('')
    || '<tr><td colspan="9" class="muted" style="text-align:center;padding:40px">No transactions match these filters</td></tr>';
  [...$('#txBody').children].forEach((tr, i) => { if (rows[i]) tr.onclick = () => openTx(rows[i]); });

  const p = App.tx.page, btns = [];
  const nums = [...new Set([1, p - 1, p, p + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  btns.push(`<button data-p="${p - 1}" ${p === 1 ? 'disabled' : ''}>‹</button>`);
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) btns.push('<span>…</span>');
    btns.push(`<button data-p="${n}" class="${n === p ? 'on' : ''}">${n}</button>`);
  });
  btns.push(`<button data-p="${p + 1}" ${p === pages ? 'disabled' : ''}>›</button>`);
  $('#txPager').innerHTML = btns.join('');
}

/* ================= MODAL ================= */
function openTx(t) {
  App.modalTx = t;
  const d = decide(t.risk), r = t.raw, items = explain(r, App.ml.model.lr.contributions(t.x));
  const review = App.reviews.get(t.id);
  $('#modalBody').innerHTML = `
    <div class="m-head"><h2>${money(t.amount)}</h2>${badge(d, true)}${reviewTag(t)}
      <span class="muted">${t.id} · ${fmtTime(t.time)}</span></div>
    <div class="m-grid">
      <div>
        <canvas class="gauge" id="mGauge"></canvas>
        <div class="split-scores">
          <div class="mini"><span>Supervised (LR)</span><b>${pct(t.p, 0)}</b></div>
          <div class="mini"><span>Anomaly (IF)</span><b>${pct(t.a, 0)}</b></div>
        </div>
        <h4>Why the AI flagged this</h4>
        <ul class="reasons">${reasonsHTML(items)}</ul>
      </div>
      <div>
        <div class="kv">
          <div><span>Customer</span><b>${esc(t.customer)} (${t.customerId})</b></div>
          <div><span>Merchant</span><b>${esc(t.category)}</b></div>
          <div><span>Location</span><b>${esc(t.city)} · ${r.distanceKm.toLocaleString('en-IN')} km</b></div>
          <div><span>Channel / device</span><b>${t.online ? 'Online' : 'In-store'} · ${r.newDevice ? 'New device' : t.online ? 'Known device' : 'Card present'}</b></div>
          <div><span>Customer avg spend</span><b>${money(r.avgSpend)} (${r.amountRatio.toFixed(1)}×)</b></div>
          <div><span>Txns last hour</span><b>${r.velocity} · ${r.minsSince >= 2880 ? 'first in 2 days' : Math.round(r.minsSince) + ' min since last'}</b></div>
        </div>
        <h4>Feature contributions</h4>
        <canvas class="chart contrib" id="mContrib"></canvas>
        <div class="truth">${t.unknown ? 'Uploaded data — <b>no ground-truth label available</b>'
          : `Simulation ground truth: <b>${t.isFraud ? '⚠ Fraud — ' + DATA.PATTERNS[t.pattern] : '✓ Genuine transaction'}</b>`}</div>
        <div class="btn-row">
          <button class="btn" id="mFraud">${icon('alert')}Confirm fraud</button>
          <button class="btn" id="mSafe">${icon('check')}Mark as safe</button>
          ${review ? '<button class="btn ghost" id="mClear">Undo review</button>' : ''}
        </div>
      </div>
    </div>`;
  $('#modal').hidden = false;
  requestAnimationFrame(() => {
    Charts.gauge($('#mGauge'), t.risk);
    drawContrib($('#mContrib'), t.x);
  });
  const setReview = v => {
    if (v) App.reviews.set(t.id, v); else App.reviews.delete(t.id);
    toast(v ? `${t.id} ${v === 'fraud' ? 'confirmed as fraud — card frozen' : 'marked as safe'}` : `Review removed for ${t.id}`, v === 'fraud' ? 'high' : 'low', v === 'fraud' ? 'alert' : 'check');
    closeModal(); render();
  };
  $('#mFraud').onclick = () => setReview('fraud');
  $('#mSafe').onclick = () => setReview('safe');
  if ($('#mClear')) $('#mClear').onclick = () => setReview(null);
}
function closeModal() { $('#modal').hidden = true; App.modalTx = null; }

/* ================= BATCH ================= */
const CSV_COLS = ['transaction_id', 'amount', 'avg_spend', 'category', 'hour', 'usual_hour', 'distance_km', 'international', 'new_device', 'online', 'txn_last_hour', 'mins_since_last'];

function sampleCsv() {
  const R = mulberry32(Date.now() % 1e9);
  const fr = App.data.txns.filter(t => t.isFraud), ok = App.data.txns.filter(t => !t.isFraud);
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const pool = i % 5 === 0 ? fr : ok;
    rows.push(pool[Math.floor(R() * pool.length)]);
  }
  const lines = rows.map(t => {
    const r = t.raw;
    return [t.id, r.amount, r.avgSpend, r.category, r.hour, r.usualHour, r.distanceKm, r.foreign, r.newDevice, r.online, r.velocity, Math.round(r.minsSince)].join(',');
  });
  return [CSV_COLS.join(','), ...lines].join('\n');
}
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('The file has no data rows.');
  const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  const missing = CSV_COLS.filter(c => c !== 'transaction_id' && !head.includes(c));
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));
  const col = name => head.indexOf(name);
  return lines.slice(1).map((line, i) => {
    const v = line.split(',').map(s => s.trim());
    const n = (name, def = 0) => { const x = parseFloat(v[col(name)]); return Number.isFinite(x) ? x : def; };
    const category = v[col('category')] || 'Online Retail';
    const amount = Math.max(1, n('amount', 1)), avgSpend = Math.max(1, n('avg_spend', amount));
    const hour = Math.min(23, Math.max(0, Math.round(n('hour', 12)))), usualHour = Math.round(n('usual_hour', 14));
    const raw = {
      amount, avgSpend, amountRatio: amount / avgSpend, hour, usualHour, hourDev: DATA.circ(hour, usualHour),
      distanceKm: Math.max(0, n('distance_km')), foreign: n('international') ? 1 : 0, newDevice: n('new_device') ? 1 : 0,
      online: n('online') ? 1 : 0, velocity: Math.max(0, n('txn_last_hour')), minsSince: Math.max(0, n('mins_since_last', 600)),
      catRisk: DATA.CAT_RISK[category] ?? 0.3, category,
    };
    const x = DATA.featurize(raw), s = App.ml.model.score(x);
    return { id: (col('transaction_id') >= 0 && v[col('transaction_id')]) || 'ROW' + (i + 1), raw, x, ...s };
  });
}
function runBatch(text, name) {
  try {
    const rows = parseCsv(text);
    App.batch = { rows, name };
    renderBatch();
    toast(`Scanned ${rows.length} rows from ${esc(name)}`, 'low', 'check');
  } catch (e) {
    toast(esc(e.message), 'high', 'alert');
  }
}
function renderBatch() {
  if (!App.batch) return;
  const { rows, name } = App.batch;
  $('#batchResults').hidden = false;
  const dec = rows.map(r => decide(r.risk));
  $('#bTotal').textContent = rows.length;
  ['approve', 'review', 'block'].forEach(k => { $('#b' + k[0].toUpperCase() + k.slice(1)).textContent = dec.filter(d => d === k).length; });
  $('#bTitle').textContent = `Scan results — ${name}`;
  const order = rows.map((r, i) => i).sort((a, b) => rows[b].risk - rows[a].risk);
  $('#bBody').innerHTML = order.map(i => {
    const r = rows[i], top = explain(r.raw, App.ml.model.lr.contributions(r.x))[0];
    return `<tr><td class="id">${esc(r.id)}</td><td class="num">${money(r.raw.amount)}</td><td>${esc(r.raw.category)}</td>
      <td>${riskCell(r.risk)}</td><td>${badge(dec[i])}</td><td class="reason">${esc(top.text)}</td></tr>`;
  }).join('');
  [...$('#bBody').children].forEach((tr, k) => {
    const r = rows[order[k]];
    tr.onclick = () => openTx({ ...r, time: Date.now(), amount: r.raw.amount, customer: 'Uploaded row', customerId: r.id, category: r.raw.category,
      city: r.raw.foreign ? 'International' : '—', online: !!r.raw.online, isFraud: false, pattern: 'none', unknown: true });
  });
}

/* ================= MODEL LAB ================= */
function renderModel() {
  const T = App.ml, thr = App.threshold, m = ML.metricsAt(T.test.risk, T.test.y, thr);
  $('#mAcc').textContent = pct(m.accuracy);
  $('#mPrec').textContent = pct(m.precision);
  $('#mRec').textContent = pct(m.recall);
  $('#mF1').textContent = pct(m.f1);
  $('#mAuc').textContent = T.rocs.ensemble.auc.toFixed(3);
  $('#mAuto').textContent = T.threshold.toFixed(2);
  $('#thrRange').value = thr;
  $('#thrOut').textContent = thr.toFixed(2);

  $('#cm').innerHTML = `
    <span></span><span class="h">Predicted genuine</span><span class="h">Predicted fraud</span>
    <span class="vh">Actual genuine</span>
    <div class="cell good"><b>${m.tn.toLocaleString('en-IN')}</b><small>True negatives</small></div>
    <div class="cell bad"><b>${m.fp}</b><small>False alarms</small></div>
    <span class="vh">Actual fraud</span>
    <div class="cell bad"><b>${m.fn}</b><small>Missed fraud</small></div>
    <div class="cell good"><b>${m.tp}</b><small>Fraud caught</small></div>`;

  Charts.line($('#chRoc'), [
    { pts: T.rocs.iforest.pts, color: css('--med'), width: 2, dash: [5, 4] },
    { pts: T.rocs.lr.pts, color: css('--accent2'), width: 2 },
    { pts: T.rocs.ensemble.pts, color: css('--accent'), width: 3, fill: true },
  ], { diagonal: true, xFmt: v => v.toFixed(1), yFmt: v => v.toFixed(1) });

  const maxLoss = Math.max(...T.loss.map(p => p[1]));
  Charts.line($('#chLoss'), [{ pts: T.loss, color: css('--accent2'), fill: true }],
    { xMax: T.loss[T.loss.length - 1][0], yMax: Math.ceil(maxLoss * 10) / 10, xFmt: v => Math.round(v), yFmt: v => v.toFixed(2) });

  const imp = [...T.importance].sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  Charts.hbars($('#chImp'), imp.map(f => DATA.FEATURES[f.j].label), imp.map(f => f.w), { signed: true, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) });

  const bins = 10, g = new Array(bins).fill(0), f = new Array(bins).fill(0);
  T.test.risk.forEach((r, i) => { const b = Math.min(bins - 1, Math.floor(r * bins)); (T.test.y[i] ? f : g)[b]++; });
  const gs = g.reduce((a, b) => a + b, 0) || 1, fs = f.reduce((a, b) => a + b, 0) || 1;
  Charts.bars($('#chDist'), g.map((_, i) => (i / bins).toFixed(1)),
    [{ values: g.map(v => (v / gs) * 100), color: css('--legit') }, { values: f.map(v => (v / fs) * 100), color: css('--high') }],
    { yFmt: v => Math.round(v) + '%' });

  const names = { ensemble: ['Hybrid ensemble ★', 'LR + IF'], lr: ['Logistic Regression', 'Supervised'], iforest: ['Isolation Forest', 'Unsupervised'] };
  $('#cmpBody').innerHTML = T.compare.map(c => `<tr><td><b>${names[c.key][0]}</b></td><td class="muted">${names[c.key][1]}</td>
    <td class="num">${c.auc.toFixed(3)}</td><td class="num">${pct(c.precision)}</td><td class="num">${pct(c.recall)}</td><td class="num">${pct(c.f1)}</td></tr>`).join('');

  const I = T.info;
  $('#trainInfo').innerHTML = [
    ['Training samples', I.trainSize.toLocaleString('en-IN') + ` (${I.fraudTrain} fraud)`],
    ['Test samples', I.testSize.toLocaleString('en-IN') + ` (${I.fraudTest} fraud)`],
    ['Features', DATA.FEATURES.length],
    ['LR training (300 epochs)', I.msLR.toFixed(0) + ' ms'],
    ['Isolation Forest (' + I.trees + ' trees)', I.msIF.toFixed(0) + ' ms'],
    ['Total pipeline', I.ms.toFixed(0) + ' ms'],
  ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
}

/* ================= TRAINING ================= */
function trainAll(opts, silent = false) {
  App.opts = { ...App.opts, ...opts };
  const wasLive = !!App.timer;
  setLive(false);
  setLoader('Generating customer transaction data…');
  setTimeout(() => {
    App.data = DATA.generate({ seed: App.opts.seed, customers: App.opts.customers });
    setLoader(`Training AI on ${App.data.txns.length.toLocaleString('en-IN')} transactions…`);
    setTimeout(() => {
      App.ml = ML.train(App.data, { seed: App.opts.seed + 1, trees: App.opts.trees });
      App.threshold = App.ml.threshold;
      App.data.txns.forEach(score);
      App.stream = DATA.createStream(App.data.customers);
      App.reviews.clear();
      App.tx.page = 1;
      App.batch = null;
      $('#batchResults').hidden = true;
      $('#chipAuc').textContent = `Model ready · AUC ${App.ml.rocs.ensemble.auc.toFixed(3)}`;
      $('#chipInfo').textContent = `LR + Isolation Forest · ${App.ml.info.ms.toFixed(0)} ms`;
      populateAnalyzer();
      hideLoader();
      render();
      if (wasLive) setLive(true);
      if (!silent) toast(`Retrained: ROC-AUC ${App.ml.rocs.ensemble.auc.toFixed(3)}, recall ${pct(ML.metricsAt(App.ml.test.risk, App.ml.test.y, App.threshold).recall)}`, 'low', 'check');
    }, 40);
  }, 40);
}

/* ================= THEME ================= */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('fs-theme', t); } catch (e) { /* storage unavailable */ }
  render();
  if (App.modalTx) openTx(App.modalTx);
}

/* ================= EVENTS ================= */
function bind() {
  $$('.nav-item').forEach(b => { b.onclick = () => go(b.dataset.view); });
  $$('[data-goto]').forEach(b => { b.onclick = () => go(b.dataset.goto); });
  $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
  $('#scrim').onclick = closeMenu;
  $('#themeToggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#modalClose').onclick = closeModal;
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // live monitor
  $('#liveToggle').onclick = () => setLive(!App.timer);
  $$('#liveSpeed button').forEach(b => {
    b.onclick = () => {
      $$('#liveSpeed button').forEach(x => x.classList.toggle('on', x === b));
      App.speed = +b.dataset.speed;
      if (App.timer) setLive(true);
    };
  });
  $('#liveInject').onclick = () => {
    App.stream.inject();
    if (!App.timer) setLive(true);
    toast('Fraud attack injected into the stream — watch the AI catch it', '', 'bolt');
  };
  $('#liveClear').onclick = () => {
    App.live = []; App.liveRisks = []; App.lv = { total: 0, approve: 0, review: 0, block: 0 };
    $('#feed').innerHTML = '<li class="empty">Feed cleared.</li>';
    renderMonitor();
  };

  // analyzer
  $('#anForm').addEventListener('input', () => { $$('.chip-btn').forEach(b => b.classList.remove('on')); renderAnalyzer(); });
  $('#anCustomer').addEventListener('change', () => applyPreset('normal'));
  ['anChannel', 'anDevice'].forEach(id => $$(`#${id} button`).forEach(b => {
    b.onclick = () => { setSeg(id, +b.dataset.v); $$('.chip-btn').forEach(x => x.classList.remove('on')); renderAnalyzer(); };
  }));
  $$('.chip-btn').forEach(b => { b.onclick = () => applyPreset(b.dataset.preset); });

  // transactions
  let deb;
  $('#txSearch').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { App.tx.q = e.target.value; App.tx.page = 1; renderTransactions(); }, 180); };
  $('#txDecision').onchange = e => { App.tx.decision = e.target.value; App.tx.page = 1; renderTransactions(); };
  $('#txCategory').onchange = e => { App.tx.category = e.target.value; App.tx.page = 1; renderTransactions(); };
  $('#txSort').onchange = e => { App.tx.sort = e.target.value; App.tx.page = 1; renderTransactions(); };
  $('#txPager').onclick = e => {
    const b = e.target.closest('button[data-p]');
    if (b && !b.disabled) { App.tx.page = +b.dataset.p; renderTransactions(); }
  };

  // batch
  const drop = $('#drop'), input = $('#csvInput');
  const readFile = file => { if (!file) return; const fr = new FileReader(); fr.onload = () => runBatch(String(fr.result), file.name); fr.readAsText(file); };
  input.onchange = () => { readFile(input.files[0]); input.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
  $('#sampleCsv').onclick = () => download('fraudshield_sample.csv', sampleCsv());
  $('#runSample').onclick = () => runBatch(sampleCsv(), 'sample.csv');
  $('#exportCsv').onclick = () => {
    if (!App.batch) return;
    const lines = App.batch.rows.map(r => [r.id, r.raw.amount, r.raw.category, r.risk.toFixed(4), DECISION[decide(r.risk)].label,
      '"' + explain(r.raw, App.ml.model.lr.contributions(r.x)).slice(0, 3).map(x => x.text).join('; ').replace(/"/g, "'") + '"'].join(','));
    download('fraudshield_results.csv', ['transaction_id,amount,category,risk_score,decision,reasons', ...lines].join('\n'));
  };

  // model lab
  $('#thrRange').oninput = e => { App.threshold = +e.target.value; $('#thrChip').textContent = App.threshold.toFixed(2); renderModel(); };
  $('#thrReset').onclick = () => { App.threshold = App.ml.threshold; render(); };
  $('#rtCust').oninput = e => { $('#rtCustOut').textContent = e.target.value; };
  $('#rtTrees').oninput = e => { $('#rtTreeOut').textContent = e.target.value; };
  $('#retrainForm').onsubmit = e => {
    e.preventDefault();
    trainAll({ customers: +$('#rtCust').value, trees: +$('#rtTrees').value, seed: Math.round(+$('#rtSeed').value) || 42 });
  };

  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { render(); if (App.modalTx) { Charts.gauge($('#mGauge'), App.modalTx.risk); drawContrib($('#mContrib'), App.modalTx.x); } }, 150);
  });
}

/* ================= BOOT ================= */
(function boot() {
  let theme = null;
  try { theme = localStorage.getItem('fs-theme'); } catch (e) { /* storage unavailable */ }
  if (!theme) theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  bind();
  populateTxFilters();
  trainAll({}, true);
})();
