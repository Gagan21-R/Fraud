'use strict';
/* =====================================================================
   FraudShield AI — Data layer
   - Synthetic (but realistic) customer + transaction generator
   - Behavioural feature engineering (the "inputs" the AI learns from)
   - Live transaction stream for the real-time monitor
   ===================================================================== */

// Small, fast, seedable pseudo-random generator so every run is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATA = (() => {
  const HOUR = 3600000, DAY = 86400000;

  // Merchant categories with a prior risk level (how often fraudsters target them)
  const CATEGORIES = [
    { name: 'Groceries',       risk: 0.08, base: 900 },
    { name: 'Restaurants',     risk: 0.12, base: 700 },
    { name: 'Fuel',            risk: 0.10, base: 1500 },
    { name: 'Utilities',       risk: 0.05, base: 2000 },
    { name: 'Pharmacy',        risk: 0.08, base: 600 },
    { name: 'Entertainment',   risk: 0.25, base: 800 },
    { name: 'Online Retail',   risk: 0.45, base: 2500 },
    { name: 'Travel',          risk: 0.50, base: 8000 },
    { name: 'Electronics',     risk: 0.65, base: 12000 },
    { name: 'Jewellery',       risk: 0.75, base: 20000 },
    { name: 'Gift Cards',      risk: 0.90, base: 3000 },
    { name: 'Crypto Exchange', risk: 0.92, base: 10000 },
  ];
  const CAT_RISK = Object.fromEntries(CATEGORIES.map(c => [c.name, c.risk]));
  const ONLINE_CATS = ['Online Retail', 'Gift Cards', 'Crypto Exchange', 'Utilities'];

  const CITIES = [
    { name: 'Bengaluru', lat: 12.97, lon: 77.59 }, { name: 'Mumbai', lat: 19.08, lon: 72.88 },
    { name: 'Delhi', lat: 28.61, lon: 77.21 },     { name: 'Chennai', lat: 13.08, lon: 80.27 },
    { name: 'Hyderabad', lat: 17.39, lon: 78.49 }, { name: 'Kolkata', lat: 22.57, lon: 88.36 },
    { name: 'Pune', lat: 18.52, lon: 73.86 },      { name: 'Ahmedabad', lat: 23.02, lon: 72.57 },
    { name: 'Jaipur', lat: 26.91, lon: 75.79 },    { name: 'Kochi', lat: 9.93, lon: 76.27 },
  ];
  const FOREIGN = [
    { name: 'Dubai', lat: 25.20, lon: 55.27, foreign: true },     { name: 'Singapore', lat: 1.35, lon: 103.82, foreign: true },
    { name: 'London', lat: 51.51, lon: -0.13, foreign: true },    { name: 'New York', lat: 40.71, lon: -74.01, foreign: true },
    { name: 'Lagos', lat: 6.52, lon: 3.38, foreign: true },       { name: 'Moscow', lat: 55.76, lon: 37.62, foreign: true },
  ];
  const ALL_CITIES = [...CITIES, ...FOREIGN];

  const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Aditya', 'Kavya',
    'Reyansh', 'Priya', 'Krish', 'Nisha', 'Dev', 'Tanvi', 'Rahul', 'Sneha', 'Vikram', 'Pooja', 'Nikhil', 'Riya', 'Siddharth',
    'Aisha', 'Karthik', 'Lakshmi', 'Manav', 'Zara'];
  const LAST = ['Sharma', 'Iyer', 'Reddy', 'Patel', 'Nair', 'Gupta', 'Rao', 'Menon', 'Singh', 'Das', 'Kulkarni', 'Joshi', 'Bose',
    'Pillai', 'Verma', 'Shetty', 'Chopra', 'Hegde', 'Mishra', 'Kapoor'];

  const PATTERNS = { ato: 'Account takeover', testing: 'Card testing', stolen: 'Stolen card', none: '—' };

  // The 11 behavioural features the AI models learn from
  const FEATURES = [
    { key: 'logAmount',   label: 'Transaction amount' },
    { key: 'amountRatio', label: 'Amount vs. usual spend' },
    { key: 'hourDev',     label: 'Deviation from usual hour' },
    { key: 'night',       label: 'Night-time (00–05h)' },
    { key: 'distance',    label: 'Distance from home' },
    { key: 'foreign',     label: 'International location' },
    { key: 'newDevice',   label: 'New / unknown device' },
    { key: 'velocity',    label: 'Transactions in last hour' },
    { key: 'recency',     label: 'Time since last txn' },
    { key: 'catRisk',     label: 'Merchant category risk' },
    { key: 'online',      label: 'Card-not-present (online)' },
  ];

  function haversine(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const circ = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
  const cityByName = n => ALL_CITIES.find(c => c.name === n) || CITIES[0];

  function makeRand(seed) {
    const r = mulberry32(seed);
    const normal = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return {
      r, normal,
      pick: a => a[Math.floor(r() * a.length)],
      int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
      chance: p => r() < p,
      poisson: lam => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; },
    };
  }

  /** Turns raw transaction context into the numeric vector fed to the models */
  function featurize(f) {
    return [
      Math.log1p(f.amount),
      Math.log(Math.max(f.amountRatio, 0.01)),
      f.hourDev / 12,
      f.hour <= 5 ? 1 : 0,
      Math.log1p(f.distanceKm),
      f.foreign,
      f.newDevice,
      Math.min(f.velocity, 10),
      Math.log1p(f.minsSince),
      f.catRisk,
      f.online,
    ];
  }

  function makeCustomers(R, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const home = R.pick(CITIES);
      const fav = [0, 1, 2, 3, 4, 5, 6].sort(() => R.r() - 0.5).slice(0, 4);
      const device = 'D-' + R.int(10000, 99999);
      out.push({
        id: 'C' + (1001 + i),
        name: R.pick(FIRST) + ' ' + R.pick(LAST),
        home,
        avgSpend: Math.round(Math.exp(6.9 + R.normal() * 0.55) / 10) * 10,
        usualHour: R.int(9, 20),
        initialDevice: device,
        devices: [device],
        fav,
        rate: 0.7 + R.r() * 1.8, // transactions per day
      });
    }
    return out;
  }

  function mk(c, time, cat, amount, city, device, online, fraud, pattern) {
    return {
      id: '', time, customerId: c.id, customer: c.name,
      amount: Math.max(10, Math.round(amount)), category: cat.name,
      city: city.name, lat: city.lat, lon: city.lon, foreign: !!city.foreign,
      device: online ? device : 'POS', online, isFraud: fraud, pattern: pattern || 'none',
    };
  }

  /** A normal transaction, with realistic "noise" (travel, new phones, big purchases) */
  function legit(R, c, time) {
    const cat = CATEGORIES[R.chance(0.85) ? R.pick(c.fav) : R.int(0, CATEGORIES.length - 1)];
    let amount = c.avgSpend * Math.exp(R.normal() * 0.6) * (cat.base / 1500) ** 0.35;
    let city = c.home;
    if (R.chance(0.05)) amount *= R.int(3, 8);   // occasional big purchase
    if (R.chance(0.06)) city = R.pick(CITIES);   // domestic travel
    if (R.chance(0.012)) city = R.pick(FOREIGN); // holiday abroad
    if (R.chance(0.04)) c.devices.unshift('D-' + R.int(10000, 99999)); // new phone / laptop
    const online = R.chance(ONLINE_CATS.includes(cat.name) ? 0.95 : 0.25);
    return mk(c, time, cat, amount, city, c.devices[0], online, false);
  }

  /** A fraud episode: one of three real-world attack patterns */
  function fraudEpisode(R, c, day, fixedStart) {
    const type = R.pick(['ato', 'ato', 'testing', 'stolen']);
    const hourFor = {
      ato: () => (R.chance(0.7) ? R.int(0, 4) : R.int(9, 22)),
      testing: () => (R.chance(0.5) ? R.int(0, 5) : R.int(8, 23)),
      stolen: () => R.int(10, 21),
    };
    let t = fixedStart ?? (day + hourFor[type]() * HOUR + R.int(0, 59) * 60000);
    const out = [];
    if (type === 'ato') {
      // Criminal logs into the account from a new device, far away, and spends big
      // ~30% are "stealthy": same city, moderate amounts
      const stealth = R.chance(0.3);
      const city = stealth ? c.home : R.chance(0.55) ? R.pick(FOREIGN) : R.pick(CITIES.filter(x => x !== c.home));
      const device = 'D-' + R.int(10000, 99999);
      const n = R.int(1, 4);
      for (let i = 0; i < n; i++) {
        const mult = stealth ? 1.5 + R.r() * 4 : 3 + R.r() * 12;
        out.push(mk(c, t, CATEGORIES[R.int(stealth ? 5 : 6, 11)], c.avgSpend * mult, city, device, true, true, 'ato'));
        t += R.int(2, 25) * 60000;
      }
    } else if (type === 'testing') {
      // Burst of tiny "test" charges, then a large cash-out
      const device = R.chance(0.7) ? 'D-' + R.int(10000, 99999) : c.devices[0];
      const city = R.chance(0.5) ? c.home : R.pick(ALL_CITIES);
      const n = R.int(4, 7);
      for (let i = 0; i < n; i++) {
        out.push(mk(c, t, CATEGORIES[R.pick([6, 10])], R.int(10, 150), city, device, true, true, 'testing'));
        t += R.int(1, 4) * 60000;
      }
      out.push(mk(c, t, CATEGORIES[R.pick([8, 10, 11])], c.avgSpend * (4 + R.r() * 8), city, device, true, true, 'testing'));
    } else {
      // Physical card stolen and used in shops
      const city = R.chance(0.4) ? c.home : R.pick(CITIES);
      const n = R.int(1, 3);
      for (let i = 0; i < n; i++) {
        out.push(mk(c, t, CATEGORIES[R.pick([8, 9, 2, 8, 0, 6])], c.avgSpend * (1.5 + R.r() * 5), city, null, false, true, 'stolen'));
        t += R.int(10, 60) * 60000;
      }
    }
    return out;
  }

  /** Computes per-customer behavioural context (velocity, devices, recency…) in time order */
  class Tracker {
    constructor(customers, knowAllDevices = false) {
      this.cust = new Map(customers.map(c => [c.id, c]));
      this.state = new Map();
      this.knowAll = knowAllDevices;
    }
    process(tx) {
      const c = this.cust.get(tx.customerId);
      let s = this.state.get(c.id);
      if (!s) {
        s = { times: [], last: null, known: new Set(this.knowAll ? c.devices : [c.initialDevice]) };
        this.state.set(c.id, s);
      }
      s.times = s.times.filter(t => tx.time - t <= HOUR && tx.time >= t);
      const hour = new Date(tx.time).getHours();
      tx.raw = {
        amount: tx.amount, avgSpend: c.avgSpend, amountRatio: tx.amount / c.avgSpend,
        hour, usualHour: c.usualHour, hourDev: circ(hour, c.usualHour),
        distanceKm: Math.round(haversine(c.home, tx)), foreign: tx.foreign ? 1 : 0,
        newDevice: tx.online && !s.known.has(tx.device) ? 1 : 0,
        online: tx.online ? 1 : 0, velocity: s.times.length,
        minsSince: s.last == null ? 2880 : Math.max(0, (tx.time - s.last) / 60000),
        catRisk: CAT_RISK[tx.category] ?? 0.3, category: tx.category,
      };
      tx.x = featurize(tx.raw);
      s.times.push(tx.time);
      s.last = tx.time;
      if (!tx.isFraud && tx.online) s.known.add(tx.device); // device verified by OTP
      return tx;
    }
  }

  /** Builds a full labelled dataset: customers + ~30 days of transactions */
  function generate({ seed = 42, customers: nCust = 250, days = 30 } = {}) {
    const R = makeRand(seed);
    const customers = makeCustomers(R, nCust);
    const start = new Date(2026, 9, 1).getTime();
    const txns = [];
    for (const c of customers) {
      for (let d = 0; d < days; d++) {
        const k = R.poisson(c.rate);
        for (let j = 0; j < k; j++) {
          let hour = Math.round(c.usualHour + R.normal() * 2.5);
          if (R.chance(0.06)) hour = R.int(0, 5); // night owls, late-night food orders
          hour = ((hour % 24) + 24) % 24;
          const t = start + d * DAY + hour * HOUR + R.int(0, 59) * 60000;
          const tx = legit(R, c, t);
          txns.push(tx);
          // split bills / shopping sprees: genuine rapid follow-up payments
          if (R.chance(0.05)) {
            let t2 = t;
            for (let k2 = R.int(1, 3); k2 > 0; k2--) {
              t2 += R.int(2, 15) * 60000;
              const f = legit(R, c, t2);
              Object.assign(f, { city: tx.city, lat: tx.lat, lon: tx.lon, foreign: tx.foreign });
              txns.push(f);
            }
          }
        }
      }
    }
    for (const c of customers) {
      if (!R.chance(0.3)) continue;
      const episodes = R.chance(0.25) ? 2 : 1;
      for (let e = 0; e < episodes; e++) txns.push(...fraudEpisode(R, c, start + R.int(1, days - 1) * DAY));
    }
    txns.sort((a, b) => a.time - b.time);
    txns.forEach((t, i) => { t.id = 'TX' + (100001 + i); });
    const tracker = new Tracker(customers);
    txns.forEach(t => tracker.process(t));
    return { customers, txns, start, days };
  }

  /** Endless real-time stream for the Live Monitor */
  function createStream(customers, seed = Math.floor(Math.random() * 1e9)) {
    const R = makeRand(seed);
    const tracker = new Tracker(customers, true);
    const base = new Date(); base.setHours(7, 0, 0, 0);
    let clock = base.getTime(), counter = 0, forceFraud = false;
    const queue = [];
    return {
      inject() { forceFraud = true; },
      next() {
        if (!queue.length) {
          const h = new Date(clock).getHours();
          clock += (h <= 5 ? R.int(8, 30) : R.int(1, 5)) * 60000;
          if (forceFraud || R.chance(0.05)) {
            forceFraud = false;
            queue.push(...fraudEpisode(R, R.pick(customers), 0, clock));
          } else {
            let c = R.pick(customers);
            for (let i = 0; i < 25 && circ(h, c.usualHour) > 3; i++) c = R.pick(customers);
            queue.push(legit(R, c, clock));
          }
        }
        const tx = queue.shift();
        clock = Math.max(clock, tx.time);
        tx.id = 'LV' + String(++counter).padStart(5, '0');
        return tracker.process(tx);
      },
    };
  }

  return { CATEGORIES, CAT_RISK, CITIES, FOREIGN, ALL_CITIES, FEATURES, PATTERNS, featurize, haversine, circ, cityByName, generate, createStream };
})();
