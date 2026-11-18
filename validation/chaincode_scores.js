'use strict';
// Scores every transaction of an EPCIS file with the real rule engine, without reading any label.
// Usage: node chaincode_scores.js <events.json> <out.json> [--chaincode <dir>] [--threshold 70]
const fs = require('fs');
const path = require('path');
const { indexEvents, readEventAt } = require('./read_events');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [eventsFile, outFile] = args;
const chaincodeDir = path.resolve(option('--chaincode', path.join(__dirname, '..', 'epcis-fraud-logistic-diversion')));
const threshold = Number(option('--threshold', 70));
const AUDIT_DELAY_DAYS = 31;

const RuleEngine = require(path.join(chaincodeDir, 'chaincode/lib/RuleEngine'));
const rulesDir = path.join(chaincodeDir, 'chaincode/lib/rules');
const Shipment = require(path.join(rulesDir, fs.existsSync(path.join(rulesDir, 'ShipmentReceiptMismatchRule.js'))
  ? 'ShipmentReceiptMismatchRule' : 'ShipmentReceiptDivergenceRule'));
const { makeCtx } = require(path.join(chaincodeDir, 'test/helpers'));

const transactionOf = event => String((event.ilmd && event.ilmd['cbvmda:transactionID']) || event['arcos:transactionID'] || '').trim();

function groupByTransaction(index) {
  const groups = new Map();
  index.forEach((entry, arrival) => {
    if (!groups.has(entry.tx)) groups.set(entry.tx, []);
    groups.get(entry.tx).push({ entry, arrival });
  });
  return groups;
}

// Same normalisation as LogisticDiversionContract.submitEvent, so the scores match what the network computes.
function flattenLocations(event) {
  for (const key of ['bizLocation', 'readPoint']) {
    if (event[key] && typeof event[key] === 'object') event[key] = event[key].id || '';
  }
  return event;
}

const toViolations = result => (result.violations || []).map(v => ({ code: v.code, score: v.score || 0 }));

async function scoreTransaction(tx, entries, fd) {
  const ctx = makeCtx();
  const ordered = [...entries].sort((a, b) => new Date(a.entry.eventTime) - new Date(b.entry.eventTime) || a.arrival - b.arrival);
  const events = [];
  let score = 0;
  for (const { entry } of ordered) {
    const event = readEventAt(fd, entry);
    const result = await RuleEngine.evaluate(ctx, flattenLocations(JSON.parse(JSON.stringify(event))));
    const violations = toViolations(result);
    score = Math.max(score, result.riskScore || 0, ...violations.map(v => v.score));
    events.push({ eventID: event.eventID, violations });
  }
  const last = new Date(ordered[ordered.length - 1].entry.eventTime).getTime();
  const pending = await Shipment.auditPendingShipments(ctx, new Date(last + AUDIT_DELAY_DAYS * 86400000));
  const auditViolations = pending.length > 0 ? [{ code: 'SHIPMENT_RECEIPT_MISMATCH_AUDIT', score: threshold }] : [];
  if (auditViolations.length) score = Math.max(score, threshold);
  return { transaction_id: tx, events, audit_violations: auditViolations, score, flagged: score >= threshold };
}

(async () => {
  const groups = groupByTransaction(indexEvents(eventsFile, event => ({ tx: transactionOf(event) })));
  const fd = fs.openSync(eventsFile, 'r');
  const transactions = [];
  for (const [tx, entries] of groups) transactions.push(await scoreTransaction(tx, entries, fd));
  fs.closeSync(fd);
  fs.writeFileSync(outFile, JSON.stringify({ threshold, transactions }));
})();
