'use strict';

const MandatoryFieldsRule = require('./rules/MandatoryFieldsRule');
const LogisticsDiversionRule = require('./rules/LogisticsDiversionRule');
const SupplyBaseComplexityRule = require('./rules/SupplyBaseComplexityRule');
const VolumeFragmentationRule = require('./rules/VolumeFragmentationRule');
const LotContaminationRule = require('./rules/LotContaminationRule');
const QuantityDiscrepancyRule = require('./rules/QuantityDiscrepancyRule');
const ShipmentReceiptDivergenceRule = require('./rules/ShipmentReceiptDivergenceRule');
const TransitDiversionRule = require('./rules/TransitDiversionRule');
const TransitTimeRule = require('./rules/TransitTimeRule');
const LifecycleSequenceRule = require('./rules/LifecycleSequenceRule');

const MAX_RISK_SCORE = 100;

// Class A: a failure rejects the event.
const BLOCKING_RULES = [new MandatoryFieldsRule()];

// Class B: the event is recorded and the highest violation score is its risk score.
// LotContaminationRule must stay last: it reads the lot state written by the other rules.
const SCORING_RULES = [
    new LogisticsDiversionRule(),
    new SupplyBaseComplexityRule(),
    new VolumeFragmentationRule(),
    new QuantityDiscrepancyRule(),
    new ShipmentReceiptDivergenceRule(),
    new TransitDiversionRule(),
    new TransitTimeRule(),
    new LifecycleSequenceRule(),
    new LotContaminationRule(),
];

// Ledger state written after scoring; the order matters because lot contamination reads the violations.
const STATE_UPDATERS = [
    (ctx, event) => LogisticsDiversionRule.updateProductState(ctx, event),
    (ctx, event) => SupplyBaseComplexityRule.updateComplexityState(ctx, event),
    (ctx, event) => VolumeFragmentationRule.updateFragmentationState(ctx, event),
    (ctx, event) => QuantityDiscrepancyRule.updateQuantityState(ctx, event),
    (ctx, event) => ShipmentReceiptDivergenceRule.updateShipmentState(ctx, event),
    (ctx, event) => TransitDiversionRule.updateTransitState(ctx, event),
    (ctx, event) => LifecycleSequenceRule.updateLifecycleState(ctx, event),
    (ctx, event, violations) => LotContaminationRule.updateLotRiskState(ctx, event, violations),
];

function toViolation(rule, result) {
    return {
        rule: rule.name,
        code: result.errorCode,
        message: result.message,
        score: result.score,
        ...result.meta,
    };
}

class RuleEngine {
    static async evaluate(ctx, event) {
        for (const rule of BLOCKING_RULES) {
            const result = await rule.evaluate(ctx, event);
            if (!result.passed) {
                return {
                    accepted: false,
                    riskScore: 0,
                    violations: [{ rule: rule.name, code: result.errorCode, message: result.message }],
                };
            }
        }

        const violations = [];
        let highestScore = 0;
        for (const rule of SCORING_RULES) {
            const result = await rule.evaluate(ctx, event);
            if (result.passed) continue;
            highestScore = Math.max(highestScore, result.score);
            violations.push(toViolation(rule, result));
        }

        for (const update of STATE_UPDATERS) {
            await update(ctx, event, violations);
        }

        return {
            accepted: true,
            eventID: event.eventID || null,
            epc: Array.isArray(event.epcList) ? (event.epcList[0] || null) : null,
            bizStep: event.bizStep || null,
            riskScore: Math.min(MAX_RISK_SCORE, highestScore),
            violations,
        };
    }
}

module.exports = RuleEngine;
