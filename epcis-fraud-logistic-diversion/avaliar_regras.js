'use strict';
// Avalia as regras por transacao: cada uma e reproduzida isolada (ledger novo); marcada se score >= 70.
// Uso: node avaliar_regras.js <pasta_do_dataset>   (precisa de events.json e scenario_template.csv)
const fs = require('fs'), path = require('path');
const RuleEngine = require('./chaincode/lib/RuleEngine');
const { makeCtx } = require('./test/helpers');
const Shipment = require('./chaincode/lib/rules/ShipmentReceiptDivergenceRule');
const THRESHOLD = 70, NEGATIVES = new Set(['none', 'recalled']);
const dir = process.argv[2];
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  return [...out, cur];
}
const [head, ...rows] = fs.readFileSync(path.join(dir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
const cols = splitCsv(head), iId = cols.indexOf('transaction_id'), iType = cols.indexOf('anomaly_type');
const labels = new Map(rows.map(r => { const c = splitCsv(r); return [c[iId].trim(), c[iType].trim()]; }));
const events = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8')).epcisBody.eventList;
const byTx = new Map();
for (const e of events) {
  const tx = e.ilmd && String(e.ilmd['cbvmda:transactionID']).trim();
  if (tx && labels.has(tx)) (byTx.get(tx) || byTx.set(tx, []).get(tx)).push(e);
}
(async () => {
  const stats = {}, causes = {};
  for (const [tx, evs] of byTx) {
    const ctx = makeCtx(); let max = 0; const codes = new Set();
    evs.sort((a, b) => new Date(a.eventTime) - new Date(b.eventTime));
    for (const e of evs) {
      const r = await RuleEngine.evaluate(ctx, e);
      max = Math.max(max, r.riskScore || 0);
      if ((r.riskScore || 0) >= THRESHOLD) (r.violations || []).forEach(v => codes.add(v.code));
    }
    // auditoria periodica: despacho sem recebimento 31 dias depois do ultimo evento
    const last = new Date(evs[evs.length - 1].eventTime).getTime();
    const pending = await Shipment.auditPendingShipments(ctx, new Date(last + 31 * 86400000));
    if (pending.length > 0) max = Math.max(max, 70);
    const s = stats[labels.get(tx)] || (stats[labels.get(tx)] = { n: 0, flagged: 0 });
    s.n++; if (max >= THRESHOLD) s.flagged++;
    const t = labels.get(tx), wrong = NEGATIVES.has(t) ? max >= THRESHOLD : max < THRESHOLD;
    if (wrong) { const k = t + ' -> ' + (NEGATIVES.has(t) ? [...codes].join('+') : 'nao detectado'); causes[k] = (causes[k] || 0) + 1; }
  }
  console.log(`\nAvaliacao por transacao (${path.basename(dir)}, limiar >= ${THRESHOLD})\n`);
  console.log('| Tipo | Transacoes | Marcadas | Taxa |\n|---|---|---|---|');
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const [t, s] of Object.entries(stats).sort()) {
    const neg = NEGATIVES.has(t);
    console.log(`| ${t}${neg ? ' (controle negativo)' : ''} | ${s.n} | ${s.flagged} | ${(100 * s.flagged / s.n).toFixed(1)}% |`);
    if (neg) { fp += s.flagged; tn += s.n - s.flagged; } else { tp += s.flagged; fn += s.n - s.flagged; }
  }
  console.log('\nErros (falso positivo ou nao detectado) por causa:');
  for (const [k, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${k}`);
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : 'n/a';
  console.log(`\nPrecisao: ${pct(tp, tp + fp)} | Recall: ${pct(tp, tp + fn)} | Falsos positivos: ${fp} de ${fp + tn} sem anomalia (${pct(fp, fp + tn)})\n`);
})();
