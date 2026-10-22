
'use strict';
 
const assert     = require('assert');

const RuleEngine = require('../chaincode/lib/RuleEngine');
const ShipmentReceiptDivergenceRule = require('../chaincode/lib/rules/ShipmentReceiptDivergenceRule');

const AUDIT_TYPES = new Set(['shipment_divergence']);
const AUDIT_DELAY_DAYS = 31;

const { makeCtx } = require('./helpers');

const fixtures   = require('./fixtures/anomalies.json');
 
const DETECTION_THRESHOLD = 70;
const KNOWN_GAPS = new Set(['item_location_mismatch']);
 
async function replayTransaction(events) {

    const ctx = makeCtx();

    let maxScore = 0;

    const fired = new Set();

    for (const event of events) {

        const result = await RuleEngine.evaluate(ctx, event);

        maxScore = Math.max(maxScore, result.riskScore);

        (result.violations || []).forEach(v => fired.add(v.code));

    }

    const last = events.reduce((t, e) => Math.max(t, new Date(e.eventTime).getTime()), 0);

    const pending = await ShipmentReceiptDivergenceRule.auditPendingShipments(ctx, new Date(last + AUDIT_DELAY_DAYS * 86400000));

    return { maxScore, fired: [...fired], pending };

}
 
describe('detection per anomaly type (real dataset fixtures)', () => {

    for (const [type, { transactionId, events }] of Object.entries(fixtures)) {

        (KNOWN_GAPS.has(type) ? it.skip : it)(`${type} (tx ${transactionId})${KNOWN_GAPS.has(type) ? ' - lacuna conhecida' : ''}`, async () => {

            const { maxScore, fired, pending } = await replayTransaction(events);

            const detected = maxScore >= DETECTION_THRESHOLD || (AUDIT_TYPES.has(type) && pending.length > 0);

            assert.strictEqual(detected, !['none', 'recalled'].includes(type), `score=${maxScore} fired=[${fired.join(',')}]`);

        });

    }

});

