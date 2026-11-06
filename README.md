# FraudShield AI — AI-Powered Fraud Detection System

**Problem statement chosen:** #3, AI-Powered Fraud Detection System
*"Build a system that uses AI to analyse financial transactions and identify potentially fraudulent activities based on unusual transaction patterns."*

---

## 1. How to run

No installation, server or internet is needed (internet is only used for the Poppins font).

1. Open the `FraudShield-AI` folder.
2. Double-click **`index.html`**. It opens in Chrome or Edge.
3. On startup the app generates about 13,000 transactions and trains both AI models in your browser, in roughly 1–3 seconds.

Optional, if you prefer a local server: `python -m http.server 8000`, then open `http://localhost:8000`.

```
FraudShield-AI/
├── index.html        UI structure (7 screens)
├── css/styles.css    Neumorphic design system (light + dark)
└── js/
    ├── data.js       Data generator + feature engineering + live stream
    ├── models.js     Logistic Regression, Isolation Forest, ensemble, metrics
    ├── charts.js     Canvas chart library (no external libraries)
    └── app.js        Application logic for every screen
```

---

## 2. The real-world problem

Digital payments (cards, UPI, net-banking) keep growing, and fraud grows with them. Banks face three difficulties:

| Challenge | Why simple rules fail |
|---|---|
| **Fraud is rare** (under 2% of transactions) | A model that always says "genuine" is 98% accurate, and useless |
| **Fraudsters adapt** | Fixed rules ("block over ₹50,000") are easy to get around, for example with many small charges |
| **Customers differ** | ₹20,000 is normal for one person and very unusual for another |

FraudShield AI learns **what normal behaviour looks like for each customer** and flags transactions that do not fit, with a reason for every decision.

---

## 3. How AI is used

### 3.1 Pipeline

```
Transaction ─► Feature engineering ─► Logistic Regression (supervised) ──┐
                (11 signals)        └► Isolation Forest   (unsupervised) ─┴► Hybrid risk score ─► Explain ─► Approve / Review / Block
```

### 3.2 Feature engineering (behavioural signals)

| # | Feature | What it captures |
|---|---|---|
| 1 | Transaction amount (log) | Absolute size of the payment |
| 2 | Amount ÷ customer's average spend | Unusually large *for this person* |
| 3 | Deviation from usual hour | Off-routine timing |
| 4 | Night-time flag (00–05h) | Classic account-takeover window |
| 5 | Distance from home city (km) | Geographic anomaly (haversine formula) |
| 6 | International location | Cross-border usage |
| 7 | New / unknown device | Device-fingerprint change |
| 8 | Transactions in the last hour | **Velocity**, typical of card-testing bursts |
| 9 | Minutes since last transaction | Rapid succession |
| 10 | Merchant category risk | Gift cards, crypto and jewellery are targeted most |
| 11 | Online (card-not-present) | Higher-risk channel |

### 3.3 Model 1: Logistic Regression (supervised learning)
* Written from scratch: features are standardised (z-score) and the model is trained with the **Adam optimiser** for 300 epochs.
* **L2 regularisation** prevents overfitting.
* **Class weighting** (√(negatives/positives)) handles the class imbalance, so the model does not ignore the rare fraud cases.
* Output: probability of fraud, P(fraud | x) = σ(w·x + b).

### 3.4 Model 2: Isolation Forest (unsupervised learning)
* An ensemble of 100 random isolation trees, each built on 256 sampled transactions.
* Anomalies are "few and different", so they are isolated in fewer random splits.
  Score: s(x) = 2^(−E[h(x)] / c(n)).
* It **needs no labels**, so it can flag new attack patterns the supervised model has never seen.

### 3.5 Hybrid ensemble
`risk = 0.8 × P(LR) + 0.2 × Anomaly(IF)`. The two models fail in different ways, so blending them gives a more robust score. The AI Model Lab compares all three on the same unseen test data.

### 3.6 Explainable AI (XAI)
For every transaction, each feature's contribution to the log-odds (`wᵢ × zᵢ`) is shown as a red or green bar chart and turned into plain-English **reason codes**, for example:
> "Amount is 8.8× this customer's average spend", "5 other transactions in the past hour (velocity spike)", "Unrecognised device".

### 3.7 Decision threshold optimisation
The blocking threshold is tuned automatically on the training data to maximise the **F2 score**. F2 weights recall higher, because a missed fraud costs a bank more than a false alarm. Scores between 55% of the threshold and the threshold go to **manual review**. Analysts can move the threshold live in the AI Model Lab.

### 3.8 Training and evaluation
* **Stratified 80/20 train–test split**, so both sets keep the same fraud ratio.
* Metrics on unseen test data: accuracy, precision, recall, F1, **ROC-AUC**, confusion matrix, ROC curve, training-loss curve, score distribution.
* Typical results (default settings): **ROC-AUC ≈ 0.98–0.99**, **recall ≈ 80–90%**, precision ≈ 65–80%.
  (Accuracy is about 99%, but it is not a meaningful measure for rare-event problems. That is why recall, precision and AUC are reported.)

### 3.9 Data
Real bank transaction data is confidential, so the system includes a **realistic synthetic data generator** with 250 customers and 30 days of activity, each customer with a home city, spending level, daily routine and devices. It includes realistic noise (travel, new phones, big genuine purchases, split bills, late-night orders) and three real fraud patterns:

| Pattern | Behaviour |
|---|---|
| 🌍 **Account takeover** | New device, often abroad and at night, several high-value purchases (30% are "stealthy", in the home city) |
| 💳 **Card testing** | A burst of tiny online charges followed by one large cash-out |
| 🧾 **Stolen card** | In-store purchases of electronics or jewellery, often in the victim's own city, the hardest case |

You can also upload **your own CSV** in Batch Scan.

---

## 4. Features (screens)

| Screen | Functionality |
|---|---|
| **Dashboard** | KPIs (transactions, blocked, detection rate, money protected), flagged-per-day chart, blocked-by-category donut, risk-by-hour chart, latest alerts, **AI-generated insights** |
| **Live Monitor** | Real-time transaction stream scored instantly, approve / review / block counters, risk timeline, 1× / 2× / 5× speed, **"Simulate attack"** button |
| **Analyzer** | What-if tool: enter any transaction (or pick a preset scenario) and see a live risk gauge, model breakdown, reason codes and feature contributions |
| **Transactions** | Search, filter, sort and paginate every scored transaction; detail pop-up with explanation; **Confirm fraud / Mark safe** analyst review |
| **Batch Scan** | Upload a CSV (drag and drop), bulk scoring, results ranked by risk with main reason, **export results CSV**, sample-file download |
| **AI Model Lab** | Metrics, threshold slider, confusion matrix, ROC curves, training loss, feature importance, score distribution, model comparison, **retrain** with new data, trees and seed |
| **How It Works** | Problem, pipeline, techniques, features, benefits, fraud patterns, tech stack |

**UI:** a **neumorphic** (soft-UI) design system with raised and inset shadows, segmented controls, sliders and toggles, a **light / dark** theme switch, and a responsive layout for desktop, tablet and mobile.

---

## 5. Benefits

1. **Stops losses early.** Fraud is blocked before money leaves the account.
2. **Fewer false alarms.** Each customer is judged against their own habits, not one fixed rule.
3. **Catches new attacks.** The unsupervised anomaly detector needs no prior examples.
4. **Transparent and auditable.** Every decision has reasons, which helps regulatory audits and customer disputes.
5. **Fast and scalable.** Scoring takes under 1 ms per transaction, so it suits real-time payments.
6. **Tunable.** The bank chooses its own balance between security and customer convenience.
7. **Human-in-the-loop.** Borderline cases go to analysts instead of being blocked automatically.

---

## 6. Use of AI tools in development

An AI coding assistant (**Claude by Anthropic**, through Claude Code) was used while building the project to:
* plan the system architecture and choose suitable ML algorithms for imbalanced fraud data,
* generate and refine code for the data generator, ML algorithms, charts and neumorphic UI,
* test the models (checking ROC-AUC, precision and recall across random seeds) and make the synthetic data more realistic when the first version was too easy (AUC ≈ 1.0),
* debug UI issues and write this documentation.

*(Edit this section to describe your own contribution and how you worked with the AI tool.)*

---

## 7. Technology stack
HTML5 · CSS3 (Neumorphism, CSS variables, Grid/Flexbox) · JavaScript ES2020 · Canvas 2D API · Logistic Regression and Isolation Forest implemented from scratch, with no ML libraries · runs fully client-side and offline.

## 8. Future scope
* Train on a real dataset (for example the Kaggle *Credit Card Fraud Detection* dataset)
* Gradient-boosted trees (XGBoost) or an autoencoder for higher accuracy
* A feedback loop where analyst "Confirm / Safe" reviews retrain the model
* A backend API, database, and SMS/OTP alerts to customers
