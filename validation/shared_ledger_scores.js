'use strict';
// Replays every event of a dataset on ONE shared ledger (the way the network sees it) and reports per-type recall and false positives.
// Usage: node shared_ledger_scores.js <dataset dir> [--order time|file] [--threshold 70] [--out result.json]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const datasetDir = args[0];
const order = option('--order', 'time');
const threshold = Number(option('--threshold', 70));
const out = option('--out');
const chaincodeDir = path.resolve(option('--chaincode', path.join(__dirname, '..', 'epcis-fraud-logistic-diversion')));
const AUDIT_DELAY_DAYS = 31;
const NEGATIVE = new Set(['none', 'recalled']);

const RuleEngine = require(path.join(chaincodeDir, 'chaincode/lib/RuleEngine'));
const Shipment = require(path.join(chaincodeDir, 'chaincode/lib/rules/ShipmentReceiptMismatchRule'));
const { makeCtx } = require(path.join(chaincodeDir, 'test/helpers'));

const transactionOf = event => String((event.ilmd && event.ilmd['cbvmda:transactionID']) || '').trim();

function flattenLocations(event) {
  for (const key of ['bizLocation', 'readPoint']) {
    if (event[key] && typeof event[key] === 'object') event[key] = event[key].id || '';
  }
  return event;
}

function readLabels() {
  const [header, ...rows] = fs.readFileSync(path.join(datasetDir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
  const columns = header.split(',');
  const iId = columns.indexOf('transaction_id');
  const iType = columns.indexOf('anomaly_type');
  return new Map(rows.map(row => {
    const cells = row.split(',');
    return [cells[iId].trim(), cells[iType].trim()];
  }));
}

(async () => {
  const events = JSON.parse(fs.readFileSync(path.join(datasetDir, 'events.json'), 'utf8')).epcisBody.eventList;
  const entries = events.map((event, arrival) => ({ event, arrival }));
  if (order === 'time') {
    entries.sort((a, b) => new Date(a.event.eventTime) - new Date(b.event.eventTime) || a.arrival - b.arrival);
  }

  const ctx = makeCtx();
  const score = new Map();
  const codes = new Map();
  for (const { event } of entries) {
    const tx = transactionOf(event);
    const result = await RuleEngine.evaluate(ctx, flattenLocations(JSON.parse(JSON.stringify(event))));
    const highest = Math.max(0, result.riskScore || 0, ...(result.violations || []).map(v => v.score || 0));
    score.set(tx, Math.max(score.get(tx) || 0, highest));
    for (const v of result.violations || []) if ((v.score || 0) >= threshold) (codes.get(tx) || codes.set(tx, new Set()).get(tx)).add(v.code || v.type || v.rule);
  }

  const last = Math.max(...entries.map(({ event }) => new Date(event.eventTime).getTime()));
  const pending = await Shipment.auditPendingShipments(ctx, new Date(last + AUDIT_DELAY_DAYS * 86400000));
  for (const { txnId } of pending) score.set(txnId, Math.max(score.get(txnId) || 0, threshold));

  const labels = readLabels();
  const perType = {};
  for (const [tx, label] of labels) {
    const row = (perType[label] = perType[label] || { lots: 0, flagged: 0 });
    row.lots++;
    if ((score.get(tx) || 0) >= threshold) row.flagged++;
  }

  const rows = Object.entries(perType).sort();
  console.log(`order=${order} threshold=${threshold} transactions=${labels.size}`);
  for (const [label, { lots, flagged }] of rows) {
    const kind = NEGATIVE.has(label) ? 'FP rate' : 'recall ';
    console.log(`${label.padEnd(24)} lots=${String(lots).padStart(5)} flagged=${String(flagged).padStart(5)} ${kind}=${(100 * flagged / lots).toFixed(1)}%`);
  }
  if (out) fs.writeFileSync(out, JSON.stringify({ order, threshold, perType, scores: Object.fromEntries(score), codes: Object.fromEntries([...codes].map(([k, v]) => [k, [...v]])) }));
})();
