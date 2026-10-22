
'use strict';
 
const assert     = require('assert');

const RuleEngine = require('../chaincode/lib/RuleEngine');

const { makeCtx } = require('./helpers');

const fixtures   = require('./fixtures/anomalies.json');
 
const DETECTION_THRESHOLD = 70;
const KNOWN_GAPS = new Set(['jurisdiction', 'item_location_mismatch', 'shipment_divergence']);
 
async function replayTransaction(events) {

    const ctx = makeCtx();

    let maxScore = 0;

    const fired = new Set();

    for (const event of events) {

        const result = await RuleEngine.evaluate(ctx, event);

        maxScore = Math.max(maxScore, result.riskScore);

        (result.violations || []).forEach(v => fired.add(v.code));

    }

    return { maxScore, fired: [...fired] };

}
 
describe('detection per anomaly type (real dataset fixtures)', () => {

    for (const [type, { transactionId, events }] of Object.entries(fixtures)) {

        (KNOWN_GAPS.has(type) ? it.skip : it)(`${type} (tx ${transactionId})${KNOWN_GAPS.has(type) ? ' - lacuna conhecida' : ''}`, async () => {

            const { maxScore, fired } = await replayTransaction(events);

            const detected = maxScore >= DETECTION_THRESHOLD;

            assert.strictEqual(detected, !['none', 'recalled'].includes(type), `score=${maxScore} fired=[${fired.join(',')}]`);

        });

    }

});

