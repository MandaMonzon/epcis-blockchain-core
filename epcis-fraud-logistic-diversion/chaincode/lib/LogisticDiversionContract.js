'use strict';

/**
 * LogisticDiversionContract.js
 * =============================
 * Main Hyperledger Fabric smart contract for logistics diversion detection.
 *
 * How it works:
 *   1. Receives a raw EPCIS 2.0 event as a JSON string.
 *   2. Normalizes GS1 object fields (bizLocation, readPoint) from {id: "..."} to plain strings.
 *   3. Runs Class A rules — rejects if any blocking rule fails.
 *   4. Saves the event to the ledger (immutable record).
 *   5. Runs Class B rules — computes cumulative risk score.
 *   6. Updates product and supply complexity state for future events.
 *   7. Returns a result object with accepted, riskScore, and any violations.
 *
 * Ledger key structure (see EpcisConstants.js):
 *   event_{eventID}            → full event JSON
 *   product_state_{epc}        → latest state per SGTIN
 *   supply_complexity_{loc}    → supplier set per buyer location
 *   vol_frag_{loc}_{src}       → fragmentation timestamps
 */

const { Contract } = require('fabric-contract-api');
const RuleEngine              = require('./RuleEngine');
const LogisticsDiversionRule  = require('./rules/LogisticsDiversionRule');
const SupplyBaseComplexityRule = require('./rules/SupplyBaseComplexityRule');
const VolumeFragmentationRule  = require('./rules/VolumeFragmentationRule');
const { STATE_KEY_PREFIX }    = require('../constants/EpcisConstants');

class LogisticDiversionContract extends Contract {
    constructor() {
        super('LogisticDiversionContract');
    }

    /**
     * submitEvent — main entry point.
     * Accepts a single EPCIS 2.0 event as a JSON string.
     */
    async submitEvent(ctx, eventJsonStr) {
        let event;
        try {
            event = JSON.parse(eventJsonStr);
        } catch (e) {
            throw new Error(`INVALID_JSON: ${e.message}`);
        }

        // GS1 EPCIS 2.0 uses object format for bizLocation and readPoint: {"id": "urn:..."}
        // Normalize to plain strings for rule processing
        if (event.bizLocation && typeof event.bizLocation === 'object') {
            event.bizLocation = event.bizLocation.id || '';
        }
        if (event.readPoint && typeof event.readPoint === 'object') {
            event.readPoint = event.readPoint.id || '';
        }

        // Run all rules
        const result = await RuleEngine.evaluate(ctx, event);

        if (!result.accepted) {
            // Class A failure — do not write to ledger
            throw new Error(JSON.stringify({ rejected: true, ...result }));
        }

        // Save the event to the ledger (immutable)
        await ctx.stub.putState(
            STATE_KEY_PREFIX.EVENT + event.eventID,
            Buffer.from(JSON.stringify(event))
        );

        // Save audit record for getAuditSummary — lightweight, indexed by eventID
        const auditRecord = {
            accepted:   result.accepted,
            eventID:    result.eventID,
            epc:        result.epc,
            bizStep:    result.bizStep,
            riskScore:  result.riskScore,
            violations: result.violations,
        };
        await ctx.stub.putState(
            STATE_KEY_PREFIX.AUDIT + event.eventID,
            Buffer.from(JSON.stringify(auditRecord))
        );

        // Update state for future rule evaluations
        await LogisticsDiversionRule.updateProductState(ctx, event);
        await SupplyBaseComplexityRule.updateComplexityState(ctx, event);
        await VolumeFragmentationRule.updateFragmentationState(ctx, event);

        return JSON.stringify(result);
    }

    /** Returns a previously submitted event by its eventID. */
    async getEvent(ctx, eventId) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.EVENT + eventId);
        if (!bytes || bytes.length === 0) throw new Error(`Event not found: ${eventId}`);
        return bytes.toString();
    }

    /** Returns the current product state (last bizStep, location, disposition) for an EPC/SGTIN. */
    async getProductState(ctx, epc) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.PRODUCT + epc);
        if (!bytes || bytes.length === 0) throw new Error(`No state found for EPC: ${epc}`);
        return bytes.toString();
    }

    /**
     * getAuditSummary — returns aggregate statistics from the ledger.
     *
     * Produces the data needed for scientific graphs:
     *   - totalEvents, rejectedEvents, acceptedEvents
     *   - riskBands: count of events per score band (0, 1–29, 30–59, 60–84, 85–100)
     *   - violationsByRule: how many times each rule fired
     *
     * These fields support:
     *   - Bar chart: violation frequency per rule
     *   - Stacked bar: Class A (rejected) vs Class B (flagged) vs clean
     *   - Histogram: riskScore distribution
     */
    async getAuditSummary(ctx) {
        const summary = {
            totalEvents:    0,
            rejectedEvents: 0,
            acceptedEvents: 0,
            riskBands: { clean: 0, elevated: 0, high: 0, critical: 0, maxRisk: 0 },
            violationsByRule: {},
        };

        const iterator = await ctx.stub.getStateByRange(
            STATE_KEY_PREFIX.AUDIT, STATE_KEY_PREFIX.AUDIT + '\xFF'
        );

        for await (const { value } of iterator) {
            const record = JSON.parse(value.toString());
            summary.totalEvents++;

            if (!record.accepted) {
                summary.rejectedEvents++;
                continue;
            }

            summary.acceptedEvents++;
            const s = record.riskScore || 0;

            if      (s === 0)        summary.riskBands.clean++;
            else if (s < 30)         summary.riskBands.elevated++;
            else if (s < 60)         summary.riskBands.high++;
            else if (s < 85)         summary.riskBands.critical++;
            else                     summary.riskBands.maxRisk++;

            for (const v of (record.violations || [])) {
                summary.violationsByRule[v.rule] = (summary.violationsByRule[v.rule] || 0) + 1;
            }
        }

        return JSON.stringify(summary);
    }
}

module.exports = LogisticDiversionContract;
