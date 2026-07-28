'use strict';

/**
 * Class B — Quantity Discrepancy Rule
 * =====================================
 * Detects a mismatch between the number of units packed into a container
 * (AggregationEvent ADD) and the number that arrived at the destination
 * (AggregationEvent DELETE) for the same SSCC lot.
 *
 * SCENARIO
 * --------
 * A legitimate shipment packs 100 SGTINs into an SSCC container at origin.
 * At destination, only 70 SGTINs are unpacked. The 30 missing units were
 * diverted in transit — a classic logistics diversion pattern.
 *
 * DETECTION LOGIC
 * ---------------
 * 1. On AggregationEvent (ADD, bizStep=packing):
 *    Save { sscc, count, sgtins[] } under key qty_add_{sscc} in the ledger.
 *
 * 2. On AggregationEvent (DELETE, bizStep=receiving):
 *    Read the saved ADD record for the same SSCC.
 *    If childEPCs.length < savedCount * (1 - TOLERANCE), fire violation.
 *
 * TOLERANCE: 10% — allows for legitimate returns / in-transit damages.
 * Discrepancy > 10% is flagged as QUANTITY_DISCREPANCY.
 *
 * REGULATORY BASIS
 * ----------------
 * DSCSA 21 USC §360eee-1(b)(1)(D):
 *   "The manufacturer ... shall ... verify the product identifier ... including
 *    lot number and expiration date" at every transaction.
 *
 * GS1 EPCIS 2.0 — AggregationEvent childEPCs:
 *   https://ref.gs1.org/standards/epcis (Section 7.3)
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode }                 = require('../../constants/EpcisConstants');
const { QUANTITY_DISCREPANCY }      = require('../../constants/RiskScoreConfig');

const QTY_KEY_PREFIX  = 'qty_add_';
const TOLERANCE       = 0.10; // 10% loss allowed before flagging

class QuantityDiscrepancyRule extends TaxonomyRule {
    constructor() {
        super(
            'QuantityDiscrepancyRule',
            'Detects quantity mismatch between AggregationEvent ADD (packing) and DELETE (receiving)'
        );
    }

    async evaluate(ctx, event) {
        // Only applies to AggregationEvents
        if (event.type !== 'AggregationEvent') return RuleResult.pass();

        const sscc = event.parentID;
        if (!sscc) return RuleResult.pass();

        if (event.action === 'ADD') {
            // Nothing to compare yet — state update happens in updateQuantityState()
            return RuleResult.pass();
        }

        if (event.action === 'DELETE') {
            const key        = QTY_KEY_PREFIX + sscc;
            const stateBytes = await ctx.stub.getState(key);
            if (!stateBytes || stateBytes.length === 0) return RuleResult.pass(); // no ADD recorded yet

            const saved        = JSON.parse(stateBytes.toString());
            const packedCount  = saved.count || 0;
            const arrivedCount = Array.isArray(event.childEPCs) ? event.childEPCs.length : 0;

            if (packedCount === 0) return RuleResult.pass();

            const lossRate = (packedCount - arrivedCount) / packedCount;
            if (lossRate > TOLERANCE) {
                return RuleResult.fail(
                    ErrorCode.QUANTITY_DISCREPANCY,
                    `SSCC ${sscc}: packed ${packedCount} units, only ${arrivedCount} arrived ` +
                    `(${(lossRate * 100).toFixed(1)}% loss — threshold ${TOLERANCE * 100}%)`,
                    QUANTITY_DISCREPANCY,
                    { packedCount, arrivedCount, lossRate: Math.round(lossRate * 100) }
                );
            }
        }

        return RuleResult.pass();
    }

    /**
     * Saves the packed quantity when an AggregationEvent ADD is processed.
     * Must be called by RuleEngine after Class B evaluation.
     */
    static async updateQuantityState(ctx, event) {
        if (event.type !== 'AggregationEvent' || event.action !== 'ADD') return;
        const sscc = event.parentID;
        if (!sscc) return;

        const key   = QTY_KEY_PREFIX + sscc;
        const state = {
            sscc,
            count:       Array.isArray(event.childEPCs) ? event.childEPCs.length : 0,
            sgtins:      Array.isArray(event.childEPCs) ? event.childEPCs : [],
            packedAt:    event.eventTime || null,
            bizLocation: event.bizLocation?.id || null,
            txnId:       event.ilmd?.['cbvmda:transactionID'] || null,
        };
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
    }
}

module.exports = QuantityDiscrepancyRule;
