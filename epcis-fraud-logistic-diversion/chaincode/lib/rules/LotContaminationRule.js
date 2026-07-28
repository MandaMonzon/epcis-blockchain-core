'use strict';

/**
 * Class B — Lot Contamination Rule
 * ==================================
 * Propagates a risk score to all events that belong to a lot (transaction)
 * where at least one event has already been flagged by another rule.
 *
 * MOTIVATION (added after initial experiment results)
 * ---------------------------------------------------
 * Initial simulation showed an event-level Recall of 48%: the system correctly
 * flagged the anomalous event within a lot but left the remaining events of that
 * same lot with score=0. This is technically correct at the event level but
 * misleading at the lot level — a contaminated lot should be treated as entirely
 * suspect per pharmaceutical regulation.
 *
 * REGULATORY BASIS
 * ----------------
 * DSCSA 21 USC §360eee-1(c) — Suspect and Illegitimate Product:
 *   "Upon determining that a product is a suspect product, the manufacturer,
 *    repackager, wholesale distributor, or dispenser shall ... quarantine such
 *    product within the possession or control of such trading partner."
 *
 *   In practice: if ANY unit of a lot is suspect, the ENTIRE transaction is
 *   placed under quarantine. This rule implements that lot-level semantics.
 *
 *   Source: https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section360eee-1
 *
 * HOW IT WORKS
 * ------------
 * 1. RuleEngine calls updateLotRiskState() after any Class B violation is
 *    detected, storing the max score for the lot in the ledger.
 * 2. On subsequent events from the same lot, this rule reads that state and
 *    returns a LOT_CONTAMINATION violation with the inherited score.
 * 3. The score is capped at LOT_CONTAMINATION (see RiskScoreConfig) to
 *    distinguish inherited risk from directly detected violations.
 *
 * LIMITATION
 * ----------
 * Requires transaction_id (lot identifier) to be present in event.ilmd.
 * Events without a transaction_id are silently skipped.
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode }                 = require('../../constants/EpcisConstants');
const { LOT_CONTAMINATION }         = require('../../constants/RiskScoreConfig');

const LOT_RISK_KEY = 'lot_risk_';

class LotContaminationRule extends TaxonomyRule {
    constructor() {
        super(
            'LotContaminationRule',
            'Propagates risk to all events in a lot where any event was already flagged (DSCSA §360eee-1(c))'
        );
    }

    async evaluate(ctx, event) {
        const txnId = extractTransactionId(event);
        if (!txnId) return RuleResult.pass();

        const key        = LOT_RISK_KEY + txnId;
        const stateBytes = await ctx.stub.getState(key);
        if (!stateBytes || stateBytes.length === 0) return RuleResult.pass();

        const state = JSON.parse(stateBytes.toString());
        if (!state.flagged) return RuleResult.pass();

        return RuleResult.fail(
            ErrorCode.LOT_CONTAMINATION,
            `Lot '${txnId}' was previously flagged by '${state.triggeredBy}' (score ${state.maxScore}). ` +
            `All events in this lot are suspect per DSCSA 21 USC §360eee-1(c).`,
            LOT_CONTAMINATION,
        );
    }

    /**
     * Called by RuleEngine after any Class B violation is detected.
     * Marks the lot as contaminated so future events inherit the risk.
     */
    static async updateLotRiskState(ctx, event, violations) {
        if (!violations || violations.length === 0) return;

        const txnId = extractTransactionId(event);
        if (!txnId) return;

        const key        = LOT_RISK_KEY + txnId;
        const stateBytes = await ctx.stub.getState(key);
        const state      = (stateBytes && stateBytes.length > 0)
            ? JSON.parse(stateBytes.toString())
            : { flagged: false, maxScore: 0, triggeredBy: null };

        const maxViolationScore = Math.max(...violations.map(v => v.score || 0));
        if (maxViolationScore > state.maxScore) {
            state.flagged      = true;
            state.maxScore     = maxViolationScore;
            state.triggeredBy  = violations[0].rule;
        }

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
    }
}

function extractTransactionId(event) {
    const ilmd = event.ilmd || {};
    return (ilmd['cbvmda:transactionID'] || ilmd['cbvmda:lotNumber'] || '').trim() || null;
}

module.exports = LotContaminationRule;
