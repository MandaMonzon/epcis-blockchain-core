'use strict';
// Shows, per anomaly type, which rules fire, with their score and frequency.
// Usage: node rule_map.js <dataset dir with events.json and scenario_template.csv>
const fs = require('fs');
const path = require('path');
const core = path.join(__dirname, '..', 'epcis-fraud-logistic-diversion');
const RuleEngine = require(path.join(core, 'chaincode/lib/RuleEngine'));
const { makeCtx } = require(path.join(core, 'test/helpers'));
const Shipment = require(path.join(core, 'chaincode/lib/rules/ShipmentReceiptDivergenceRule'));

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node rule_map.js <dataset dir>');
  process.exit(1);
}

const [head, ...rows] = fs.readFileSync(path.join(dir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const iId = cols.indexOf('transaction_id');
const iType = cols.indexOf('anomaly_type');
const labels = new Map(rows.map(r => { const c = r.split(','); return [c[iId].trim(), c[iType].trim()]; }));

const events = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'))).epcisBody.eventList;
const byTx = new Map();
for (const e of events) {
  const tx = String((e.ilmd || {})['cbvmda:transactionID'] || '').trim();
  if (labels.has(tx)) (byTx.get(tx) || byTx.set(tx, []).get(tx)).push(e);
}

async function firedRules(txEvents) {
  const ctx = makeCtx();
  const fired = {};
  txEvents.sort((a, b) => new Date(a.eventTime) - new Date(b.eventTime));
  for (const e of txEvents) {
    const r = await RuleEngine.evaluate(ctx, e);
    for (const v of r.violations || []) fired[v.code] = Math.max(fired[v.code] || 0, v.score || r.riskScore || 0);
  }
  const lastEvent = new Date(txEvents[txEvents.length - 1].eventTime).getTime();
  const pending = await Shipment.auditPendingShipments(ctx, new Date(lastEvent + 31 * 86400000));
  if (pending.length) fired.SHIPMENT_DIVERGENCE_AUDIT = 70;
  return fired;
}

(async () => {
  const byType = {};
  for (const [tx, txEvents] of byTx) {
    const type = labels.get(tx);
    const entry = byType[type] || (byType[type] = { total: 0, rules: {} });
    entry.total++;
    for (const [code, score] of Object.entries(await firedRules(txEvents))) {
      const r = entry.rules[code] || (entry.rules[code] = { count: 0, score });
      r.count++;
    }
  }
  for (const [type, { total, rules }] of Object.entries(byType).sort()) {
    const top = Object.entries(rules).sort((a, b) => b[1].count - a[1].count).slice(0, 5)
      .map(([code, r]) => `${code}:${r.score}(${Math.round(100 * r.count / total)}%)`);
    console.log(type, total, top.join(' '));
  }
})();
