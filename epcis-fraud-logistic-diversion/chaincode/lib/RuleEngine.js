'use strict';

/**
 * RuleEngine.js
 * =============
 * Orchestrates the two-layer validation:
 *
 *   Class A (blocking): runs first — if any rule fails, the event is rejected.
 *   Class B (cumulative): runs after Class A passes — scores are summed and
 *                         clamped to [0, 100].
 *
 * State updates: after evaluation, the engine persists per-EPC and per-buyer
 * state so sequence checks, timing checks, and fragmentation counts work
 * correctly across events.
 *
 * The final result includes:
 *   - accepted: true/false
 *   - riskScore: 0–100 (only set when accepted = true)
 *   - violations: list of rule failures with their codes and messages
 */

const MandatoryFieldsRule           = require('./rules/MandatoryFieldsRule');
const LogisticsDiversionRule        = require('./rules/LogisticsDiversionRule');
const SupplyBaseComplexityRule       = require('./rules/SupplyBaseComplexityRule');
const VolumeFragmentationRule        = require('./rules/VolumeFragmentationRule');
const LotContaminationRule           = require('./rules/LotContaminationRule');
const QuantityDiscrepancyRule        = require('./rules/QuantityDiscrepancyRule');
const ShipmentReceiptDivergenceRule  = require('./rules/ShipmentReceiptDivergenceRule');
const TransitDiversionRule           = require('./rules/TransitDiversionRule');

// Class A — any failure immediately rejects the event
const CLASS_A_RULES = [
    new MandatoryFieldsRule(),
];

// Class B — scores accumulate; event is still recorded but flagged
const CLASS_B_RULES = [
    new LogisticsDiversionRule(),
    // TODO: discuss with Fausto whether SupplyBaseComplexityRule belongs here.
    // Skilton et al. (2024) derived the ≥9 suppliers threshold from domestic US
    // ARCOS data. Our scenario is EU→US logistics diversion — the buyer's supplier
    // count reflects legitimate domestic purchasing patterns, not cross-border
    // transit anomalies. Keeping this rule may inflate false positives without
    // adding scientific validity to the logistics diversion detection.
    // new SupplyBaseComplexityRule(),
    new VolumeFragmentationRule(),
    new QuantityDiscrepancyRule(),        // AggregationEvent: packed ≠ arrived count
    new ShipmentReceiptDivergenceRule(),  // TransactionEvent: desadv without recadv
    new TransitDiversionRule(),           // receiving location ≠ declared destination
    new LotContaminationRule(),           // must run last — reads lot state set by other rules
];

class RuleEngine {
    /**
     * Evaluates an EPCIS event against all rules.
     * Returns { accepted, riskScore, violations }.
     */
    static async evaluate(ctx, event) {
        const violations = [];

        // Class A — blocking
        for (const rule of CLASS_A_RULES) {
            const result = await rule.evaluate(ctx, event);
            if (!result.passed) {
                return {
                    accepted:  false,
                    riskScore: 0,
                    violations: [{ rule: rule.name, code: result.errorCode, message: result.message }],
                };
            }
        }

        // Class B — cumulative risk scoring
        let totalScore = 0;
        for (const rule of CLASS_B_RULES) {
            const result = await rule.evaluate(ctx, event);
            if (!result.passed) {
                totalScore += result.score;
                const violation = {
                    rule:    rule.name,
                    code:    result.errorCode,
                    message: result.message,
                    score:   result.score,
                };
                // Merge any extra fields from meta (e.g. supplierCount from SupplyBaseComplexityRule)
                if (result.meta) Object.assign(violation, result.meta);
                violations.push(violation);
            }
        }

        // Persist ledger state so future events can check sequences,
        // timing, supply complexity, fragmentation, quantity, and transit patterns.
        await LogisticsDiversionRule.updateProductState(ctx, event);
        await SupplyBaseComplexityRule.updateComplexityState(ctx, event);
        await VolumeFragmentationRule.updateFragmentationState(ctx, event);
        await QuantityDiscrepancyRule.updateQuantityState(ctx, event);
        await ShipmentReceiptDivergenceRule.updateShipmentState(ctx, event);
        await TransitDiversionRule.updateTransitState(ctx, event);
        await LotContaminationRule.updateLotRiskState(ctx, event, violations);

        // Score is clamped to [0, 100]
        const riskScore = Math.min(100, totalScore);

        return {
            accepted:   true,
            eventID:    event.eventID   || null,
            epc:        Array.isArray(event.epcList) ? (event.epcList[0] || null) : null,
            bizStep:    event.bizStep   || null,
            riskScore,
            violations,
        };
    }
}

module.exports = RuleEngine;
