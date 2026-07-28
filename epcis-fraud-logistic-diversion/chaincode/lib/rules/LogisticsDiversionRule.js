'use strict';

/**
 * Class B — Logistics Diversion Rule
 * ====================================
 * Detects suspicious patterns that indicate a product is being diverted
 * from its intended distribution path.
 *
 * Checks (in order):
 *   1. Blocked disposition — product is recalled/expired/damaged but still moving
 *   2. Invalid bizStep sequence — e.g. shipping without commissioning first
 *   3. Out-of-order event time — event arrives before the previous recorded one
 *   4. Cross-jurisdiction at unauthorized bizStep — e.g. EU→US during dispensing
 *
 * References:
 *   GS1 CBV 2.0 — authorized transitions and dispositions
 *   FDA 21 CFR §7.41 — Recall classification (Class I / II / III)
 *   DSCSA 21 USC §360eee — Suspect / Illegitimate product definitions
 *   EU Delegated Regulation 2016/161 — Serialization and verification (FMD)
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const {
    ErrorCode,
    STATE_KEY_PREFIX,
    AUTHORIZED_TRANSITIONS,
    BLOCKED_DISPOSITIONS,
    CROSS_JURISDICTION_STEPS,
} = require('../../constants/EpcisConstants');
const { BLOCKED_DISPOSITION, BLOCKED_STATUS, INVALID_SEQUENCE, CROSS_JURISDICTION, OUT_OF_ORDER } = require('../../constants/RiskScoreConfig');

// ─── Remove local SCORE dict — all scores now come from RiskScoreConfig ───────

class LogisticsDiversionRule extends TaxonomyRule {
    constructor() {
        super(
            'LogisticsDiversionRule',
            'Detects diversion: blocked dispositions, invalid sequences, timing violations, jurisdiction mismatches (Class B)'
        );
    }

    async evaluate(ctx, event) {
        // Check 1: current event has a blocked disposition (recalled, expired, etc.)
        if (event.disposition && BLOCKED_DISPOSITIONS.has(event.disposition)) {
            return RuleResult.fail(
                ErrorCode.LOGISTICS_DIVERSION_BLOCKED_DISPOSITION,
                `Disposition '${event.disposition}' is blocked — product cannot be moved at bizStep '${event.bizStep}'`,
                BLOCKED_DISPOSITION
            );
        }

        // Check 2 & 3: look up previous state for each serialized item (EPC/SGTIN)
        for (const epc of (event.epcList || [])) {
            const stateBytes = await ctx.stub.getState(STATE_KEY_PREFIX.PRODUCT + epc);
            if (!stateBytes || stateBytes.length === 0) continue; // first event for this item — nothing to compare

            const prev = JSON.parse(stateBytes.toString());

            // Check 2: the transition from the previous bizStep must be authorized
            const allowedNext = AUTHORIZED_TRANSITIONS[prev.lastBizStep];
            if (allowedNext !== undefined && !allowedNext.includes(event.bizStep)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_SEQUENCE,
                    `Invalid sequence for ${epc}: '${prev.lastBizStep}' → '${event.bizStep}' is not allowed`,
                    INVALID_SEQUENCE
                );
            }

            // Check 3: this event must not arrive before the previous one
            if (prev.lastEventTime && new Date(event.eventTime) < new Date(prev.lastEventTime)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_TIMING,
                    `Out-of-order event for ${epc}: ${event.eventTime} is before last recorded ${prev.lastEventTime}`,
                    OUT_OF_ORDER
                );
            }

            // Check 3b: product with a blocked disposition must not continue moving
            if (prev.disposition && BLOCKED_DISPOSITIONS.has(prev.disposition)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_BLOCKED_STATUS,
                    `${epc} has recorded disposition '${prev.disposition}' and cannot proceed to '${event.bizStep}'`,
                    BLOCKED_STATUS
                );
            }
        }

        // Check 4: cross-jurisdiction transfer at a step that doesn't allow it
        const srcJurisdiction = extractJurisdiction(event.sourceList);
        const dstJurisdiction = extractJurisdiction(event.destinationList);
        if (srcJurisdiction && dstJurisdiction && srcJurisdiction !== dstJurisdiction) {
            if (!CROSS_JURISDICTION_STEPS.has(event.bizStep)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_JURISDICTION,
                    `Cross-jurisdiction move (${srcJurisdiction} → ${dstJurisdiction}) not allowed at '${event.bizStep}'`,
                    CROSS_JURISDICTION
                );
            }
        }

        return RuleResult.pass();
    }

    /**
     * Saves the latest state for each EPC after a valid event.
     * Must be called by the contract after all rules pass.
     */
    static async updateProductState(ctx, event) {
        if (!Array.isArray(event.epcList)) return;
        for (const epc of event.epcList) {
            const key        = STATE_KEY_PREFIX.PRODUCT + epc;
            const stateBytes = await ctx.stub.getState(key);
            const state      = (stateBytes && stateBytes.length > 0)
                ? JSON.parse(stateBytes.toString())
                : {};

            state.lastBizStep   = event.bizStep;
            state.lastEventTime = event.eventTime;
            state.lastLocation  = event.bizLocation || null;
            state.disposition   = event.disposition || state.disposition || null;
            state.history       = state.history || [];
            state.history.push(event.eventID);

            await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
        }
    }
}

/** Infers jurisdiction (EU or US) from a CBV sourceList or destinationList. */
function extractJurisdiction(list) {
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
        // GS1 CBV: sourceList uses "source", destinationList uses "destination"
        const val = String(entry.source || entry.destination || entry.value || '').toLowerCase();
        if (val.includes('eu.') || val.includes('.eu')) return 'EU';
        if (val.includes('us.') || val.includes('.us')) return 'US';
    }
    return null;
}

module.exports = LogisticsDiversionRule;
