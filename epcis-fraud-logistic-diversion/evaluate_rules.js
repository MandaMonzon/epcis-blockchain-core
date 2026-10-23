'use strict';
// Replays each transaction in isolation (fresh ledger) and flags it when its score reaches THRESHOLD.
// Usage: node evaluate_rules.js <dataset dir> [--json <output file>]
// The dataset dir needs events.json and scenario_template.csv.
const fs = require('fs');
const path = require('path');
const RuleEngine = require('./chaincode/lib/RuleEngine');
const { makeCtx } = require('./test/helpers');
const Shipment = require('./chaincode/lib/rules/ShipmentReceiptMismatchRule');

const THRESHOLD = 70;
const NEGATIVES = new Set(['none', 'recalled']);
const AUDIT_DELAY_DAYS = 31;
const dir = process.argv[2];

function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  return [...out, cur];
}

function loadLabels() {
  const [head, ...rows] = fs.readFileSync(path.join(dir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
  const cols = splitCsv(head);
  const iId = cols.indexOf('transaction_id');
  const iType = cols.indexOf('anomaly_type');
  return new Map(rows.map(r => { const c = splitCsv(r); return [c[iId].trim(), c[iType].trim()]; }));
}

function groupByTransaction(labels) {
  const events = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8')).epcisBody.eventList;
  const byTx = new Map();
  for (const e of events) {
    const tx = e.ilmd && String(e.ilmd['cbvmda:transactionID']).trim();
    if (tx && labels.has(tx)) (byTx.get(tx) || byTx.set(tx, []).get(tx)).push(e);
  }
  return byTx;
}

async function scoreTransaction(events) {
  const ctx = makeCtx();
  const codes = new Set();
  let max = 0;
  events.sort((a, b) => new Date(a.eventTime) - new Date(b.eventTime));
  for (const e of events) {
    const r = await RuleEngine.evaluate(ctx, e);
    max = Math.max(max, r.riskScore || 0);
    if ((r.riskScore || 0) >= THRESHOLD) (r.violations || []).forEach(v => codes.add(v.code));
  }
  const lastEvent = new Date(events[events.length - 1].eventTime).getTime();
  const pending = await Shipment.auditPendingShipments(ctx, new Date(lastEvent + AUDIT_DELAY_DAYS * 86400000));
  if (pending.length > 0) max = Math.max(max, THRESHOLD);
  return { max, codes };
}

const percent = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

(async () => {
  const labels = loadLabels();
  const stats = {};
  const causes = {};
  for (const [tx, events] of groupByTransaction(labels)) {
    const type = labels.get(tx);
    const { max, codes } = await scoreTransaction(events);
    const flagged = max >= THRESHOLD;
    const s = stats[type] || (stats[type] = { n: 0, flagged: 0 });
    s.n++;
    if (flagged) s.flagged++;
    if (NEGATIVES.has(type) === flagged) {
      const key = `${type} -> ${NEGATIVES.has(type) ? [...codes].join('+') : 'not detected'}`;
      causes[key] = (causes[key] || 0) + 1;
    }
  }

  let tp = 0, fn = 0, fp = 0, tn = 0;
  console.log(`\nPer-transaction evaluation (${path.basename(dir)}, threshold >= ${THRESHOLD})\n`);
  console.log('| Type | Transactions | Flagged | Rate |\n|---|---|---|---|');
  for (const [type, s] of Object.entries(stats).sort()) {
    const negative = NEGATIVES.has(type);
    console.log(`| ${type}${negative ? ' (negative control)' : ''} | ${s.n} | ${s.flagged} | ${percent(s.flagged, s.n)} |`);
    if (negative) { fp += s.flagged; tn += s.n - s.flagged; } else { tp += s.flagged; fn += s.n - s.flagged; }
  }
  console.log('\nErrors (false positives or misses) by cause:');
  for (const [key, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${key}`);
  console.log(`\nPrecision: ${percent(tp, tp + fp)} | Recall: ${percent(tp, tp + fn)} | False positives: ${fp} of ${fp + tn} normal (${percent(fp, fp + tn)})\n`);

  const jsonIndex = process.argv.indexOf('--json');
  if (jsonIndex > 0) {
    const result = { dataset: path.basename(dir), threshold: THRESHOLD, stats, causes, tp, fn, fp, tn };
    fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(result, null, 2));
  }
})();
