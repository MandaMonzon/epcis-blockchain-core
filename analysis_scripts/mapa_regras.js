// Mostra, por tipo de anomalia, quais regras disparam, o score e a frequencia.
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'epcis-fraud-logistic-diversion');
const RuleEngine = require(base + '/chaincode/lib/RuleEngine');
const { makeCtx } = require(base + '/test/helpers');
const Shipment = require(base + '/chaincode/lib/rules/ShipmentReceiptDivergenceRule');
const dir = process.argv[2];
if (!dir) { console.error('uso: node mapa_regras.js <pasta com events.json e scenario_template.csv>'); process.exit(1); }
const lines = fs.readFileSync(path.join(dir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
const head = lines[0].split(','), iId = head.indexOf('transaction_id'), iT = head.indexOf('anomaly_type');
const labels = new Map(lines.slice(1).map(l => { const c = l.split(','); return [c[iId].trim(), c[iT].trim()]; }));
const events = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'))).epcisBody.eventList;
const byTx = new Map();
for (const e of events) {
  const tx = String((e.ilmd || {})['cbvmda:transactionID'] || '').trim();
  if (labels.has(tx)) (byTx.get(tx) || byTx.set(tx, []).get(tx)).push(e);
}
(async () => {
  const res = {};
  for (const [tx, evs] of byTx) {
    const t = labels.get(tx); const ctx = makeCtx(); const hit = {};
    evs.sort((a, b) => new Date(a.eventTime) - new Date(b.eventTime));
    for (const e of evs) {
      const r = await RuleEngine.evaluate(ctx, e);
      for (const v of (r.violations || [])) hit[v.code] = Math.max(hit[v.code] || 0, v.score || v.riskScore || r.riskScore || 0);
    }
    const last = new Date(evs[evs.length - 1].eventTime).getTime();
    if ((await Shipment.auditPendingShipments(ctx, new Date(last + 31 * 86400000))).length) hit.SHIPMENT_DIVERGENCE_AUDIT = 70;
    res[t] = res[t] || {};
    for (const [c, s] of Object.entries(hit)) { res[t][c] = res[t][c] || { n: 0, s }; res[t][c].n++; }
    res[t].__n = (res[t].__n || 0) + 1;
  }
  for (const [t, o] of Object.entries(res).sort()) {
    const n = o.__n; delete o.__n;
    console.log(t, n, Object.entries(o).sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([c, v]) => `${c}:${v.s}(${Math.round(100 * v.n / n)}%)`).join(' '));
  }
})();
