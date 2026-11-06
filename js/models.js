'use strict';
/* =====================================================================
   FraudShield AI — Machine-learning engine (written from scratch)
   1. Logistic Regression  (supervised: learns from labelled fraud cases)
   2. Isolation Forest     (unsupervised: finds anomalies with no labels)
   3. Hybrid ensemble      (weighted blend → final risk score 0..1)
   + evaluation metrics: accuracy, precision, recall, F1, ROC-AUC
   ===================================================================== */

const ML = (() => {
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

  /* ---------------- Logistic Regression (Adam optimiser, L2, class weights) ---------------- */
  class LogisticRegression {
    constructor({ lr = 0.05, epochs = 300, l2 = 1e-3 } = {}) { Object.assign(this, { lr, epochs, l2 }); }

    standardize(x) { return x.map((v, j) => (v - this.mean[j]) / this.std[j]); }

    fit(X, y) {
      const n = X.length, d = X[0].length;
      this.mean = new Array(d).fill(0);
      this.std = new Array(d).fill(0);
      for (const x of X) for (let j = 0; j < d; j++) this.mean[j] += x[j] / n;
      for (const x of X) for (let j = 0; j < d; j++) this.std[j] += (x[j] - this.mean[j]) ** 2 / n;
      this.std = this.std.map(s => Math.sqrt(s) || 1);
      const Z = X.map(x => this.standardize(x));

      // fraud is rare → up-weight positive examples so the model doesn't ignore them
      const pos = y.reduce((a, b) => a + b, 0);
      const wPos = Math.sqrt((n - pos) / Math.max(pos, 1));

      this.w = new Array(d).fill(0); this.b = 0; this.loss = [];
      const m = new Array(d + 1).fill(0), v = new Array(d + 1).fill(0);
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;

      for (let e = 1; e <= this.epochs; e++) {
        const g = new Array(d + 1).fill(0);
        let L = 0, W = 0;
        for (let i = 0; i < n; i++) {
          const z = Z[i];
          let s = this.b;
          for (let j = 0; j < d; j++) s += this.w[j] * z[j];
          const p = sigmoid(s), wt = y[i] ? wPos : 1, err = (p - y[i]) * wt;
          for (let j = 0; j < d; j++) g[j] += err * z[j];
          g[d] += err;
          L -= wt * (y[i] ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
          W += wt;
        }
        for (let j = 0; j <= d; j++) {
          g[j] = g[j] / W + (j < d ? this.l2 * this.w[j] : 0);
          m[j] = b1 * m[j] + (1 - b1) * g[j];
          v[j] = b2 * v[j] + (1 - b2) * g[j] * g[j];
          const step = this.lr * (m[j] / (1 - b1 ** e)) / (Math.sqrt(v[j] / (1 - b2 ** e)) + eps);
          if (j < d) this.w[j] -= step; else this.b -= step;
        }
        if (e % 5 === 0 || e === 1) this.loss.push([e, L / W]);
      }
      return this;
    }

    predict(x) {
      const z = this.standardize(x);
      let s = this.b;
      for (let j = 0; j < z.length; j++) s += this.w[j] * z[j];
      return sigmoid(s);
    }

    /** Per-feature contribution to the log-odds (explainability) */
    contributions(x) { return this.standardize(x).map((z, j) => this.w[j] * z); }
  }

  /* ---------------- Isolation Forest ---------------- */
  const cFactor = n => (n > 2 ? 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n : n === 2 ? 1 : 0);

  class IsolationForest {
    constructor({ trees = 100, sample = 256, seed = 11 } = {}) {
      this.nTrees = trees; this.sample = sample; this.rand = mulberry32(seed);
    }
    fit(X) {
      const psi = Math.min(this.sample, X.length);
      this.cn = cFactor(psi);
      const maxD = Math.ceil(Math.log2(psi));
      this.trees = [];
      for (let t = 0; t < this.nTrees; t++) {
        const S = [];
        for (let i = 0; i < psi; i++) S.push(X[Math.floor(this.rand() * X.length)]);
        this.trees.push(this.build(S, 0, maxD));
      }
      return this;
    }
    build(S, depth, maxD) {
      if (depth >= maxD || S.length <= 1) return { size: S.length };
      const d = S[0].length, feats = [...Array(d).keys()];
      for (let k = d - 1; k > 0; k--) { const j = Math.floor(this.rand() * (k + 1)); [feats[k], feats[j]] = [feats[j], feats[k]]; }
      for (const q of feats) {
        let lo = Infinity, hi = -Infinity;
        for (const x of S) { if (x[q] < lo) lo = x[q]; if (x[q] > hi) hi = x[q]; }
        if (hi > lo) {
          const p = lo + this.rand() * (hi - lo), L = [], R = [];
          for (const x of S) (x[q] < p ? L : R).push(x);
          return { q, p, left: this.build(L, depth + 1, maxD), right: this.build(R, depth + 1, maxD) };
        }
      }
      return { size: S.length };
    }
    pathLength(x) {
      let total = 0;
      for (const tree of this.trees) {
        let node = tree, d = 0;
        while (node.size === undefined) { node = x[node.q] < node.p ? node.left : node.right; d++; }
        total += d + cFactor(node.size);
      }
      return total / this.trees.length;
    }
    /** 0.5 ≈ normal, → 1 = easily isolated = anomalous */
    score(x) { return Math.pow(2, -this.pathLength(x) / this.cn); }
  }

  /* ---------------- Metrics ---------------- */
  function confusion(scores, labels, thr) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (let i = 0; i < scores.length; i++) {
      const pred = scores[i] >= thr;
      if (pred && labels[i]) tp++; else if (pred) fp++; else if (labels[i]) fn++; else tn++;
    }
    return { tp, fp, tn, fn };
  }
  function metricsAt(scores, labels, thr) {
    const c = confusion(scores, labels, thr);
    const precision = c.tp / Math.max(1, c.tp + c.fp), recall = c.tp / Math.max(1, c.tp + c.fn);
    return {
      ...c, precision, recall,
      accuracy: (c.tp + c.tn) / Math.max(1, scores.length),
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      fpr: c.fp / Math.max(1, c.fp + c.tn),
    };
  }
  function roc(scores, labels) {
    const idx = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const P = labels.reduce((a, b) => a + b, 0), N = labels.length - P;
    let tp = 0, fp = 0, auc = 0, pf = 0, pt = 0;
    const pts = [[0, 0]];
    for (let k = 0; k < idx.length; k++) {
      if (labels[idx[k]]) tp++; else fp++;
      if (k === idx.length - 1 || scores[idx[k + 1]] !== scores[idx[k]]) {
        const fx = fp / Math.max(1, N), ty = tp / Math.max(1, P);
        auc += ((fx - pf) * (ty + pt)) / 2;
        pf = fx; pt = ty;
        pts.push([fx, ty]);
      }
    }
    const step = Math.max(1, Math.floor(pts.length / 250));
    const thin = pts.filter((_, i) => i % step === 0);
    thin.push(pts[pts.length - 1]);
    return { pts: thin, auc };
  }
  /** Threshold maximising F-beta. beta = 2 weights recall higher: missing fraud costs more than a false alarm */
  function bestThreshold(scores, labels, beta = 2) {
    let best = 0.5, bestF = -1;
    for (let t = 0.05; t <= 0.951; t += 0.01) {
      const m = metricsAt(scores, labels, t), b2 = beta * beta;
      const f = m.precision + m.recall ? ((1 + b2) * m.precision * m.recall) / (b2 * m.precision + m.recall) : 0;
      if (f > bestF) { bestF = f; best = +t.toFixed(2); }
    }
    return best;
  }
  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  /* ---------------- Training pipeline ---------------- */
  function train(dataset, { seed = 7, trees = 100, wLR = 0.8 } = {}) {
    const t0 = performance.now();
    const txns = dataset.txns, rand = mulberry32(seed);

    // stratified 80 / 20 train–test split: both sets keep the same fraud ratio
    const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
    const pos = shuffle(txns.map((t, i) => (t.isFraud ? i : -1)).filter(i => i >= 0));
    const neg = shuffle(txns.map((t, i) => (t.isFraud ? -1 : i)).filter(i => i >= 0));
    const nP = Math.round(pos.length * 0.2), nN = Math.round(neg.length * 0.2);
    const testIdx = [...pos.slice(0, nP), ...neg.slice(0, nN)];
    const trainIdx = shuffle([...pos.slice(nP), ...neg.slice(nN)]);
    const Xtr = trainIdx.map(i => txns[i].x), ytr = trainIdx.map(i => (txns[i].isFraud ? 1 : 0));
    const Xte = testIdx.map(i => txns[i].x), yte = testIdx.map(i => (txns[i].isFraud ? 1 : 0));

    const lr = new LogisticRegression().fit(Xtr, ytr);
    const tLR = performance.now();
    const iso = new IsolationForest({ trees, seed: seed + 3 }).fit(Xtr);
    const tIF = performance.now();

    const rawTr = Xtr.map(x => iso.score(x)).sort((a, b) => a - b);
    const aLo = percentile(rawTr, 0.5), aHi = percentile(rawTr, 0.995);
    const wIF = 1 - wLR;

    const model = {
      lr, iso, wLR, wIF,
      anomaly(x) { return clamp((iso.score(x) - aLo) / Math.max(1e-6, aHi - aLo)); },
      score(x) {
        const p = lr.predict(x), a = this.anomaly(x);
        return { p, a, risk: wLR * p + wIF * a };
      },
    };

    // every threshold is tuned on training data only, so test metrics stay honest
    const tr = Xtr.map(x => model.score(x));
    const trThr = {
      ensemble: bestThreshold(tr.map(s => s.risk), ytr),
      lr: bestThreshold(tr.map(s => s.p), ytr),
      iforest: bestThreshold(tr.map(s => s.a), ytr),
    };
    const threshold = trThr.ensemble;

    const te = Xte.map(x => model.score(x));
    const test = { risk: te.map(s => s.risk), p: te.map(s => s.p), a: te.map(s => s.a), y: yte };
    const rocs = { ensemble: roc(test.risk, yte), lr: roc(test.p, yte), iforest: roc(test.a, yte) };
    const compare = ['ensemble', 'lr', 'iforest'].map(k => {
      const s = k === 'ensemble' ? test.risk : k === 'lr' ? test.p : test.a;
      return { key: k, auc: rocs[k].auc, thr: trThr[k], ...metricsAt(s, yte, trThr[k]) };
    });

    const imp = lr.w.map(Math.abs), impMax = Math.max(...imp);
    return {
      model, threshold, test, rocs, compare,
      importance: lr.w.map((w, j) => ({ j, w, rel: imp[j] / impMax })),
      loss: lr.loss,
      info: {
        trainSize: Xtr.length, testSize: Xte.length,
        fraudTrain: ytr.reduce((a, b) => a + b, 0), fraudTest: yte.reduce((a, b) => a + b, 0),
        msLR: tLR - t0, msIF: tIF - tLR, ms: performance.now() - t0, trees,
      },
    };
  }

  return { LogisticRegression, IsolationForest, train, metricsAt, roc, bestThreshold };
})();
