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
 *   event_{eventID}                    → full event JSON
 *   audit_result_{eventID}             → audit record
 *   productState(epc, eventID)         → one immutable record per event per SGTIN
 *   supplyComplexity(loc, supplierId)  → one immutable marker per distinct supplier
 *   fragmentation(loc, srcId, eventID) → one immutable timestamp per receiving event
 *
 * The last three use Fabric composite keys instead of a single shared key per
 * entity — each write targets a brand-new key, so concurrent transactions for
 * the same product/location never race on a read-modify-write cycle (which
 * was the cause of MVCC_READ_CONFLICT under load).
 */

const { Contract } = require('fabric-contract-api');
const RuleEngine           = require('./RuleEngine');
const HistoryStore         = require('./util/HistoryStore');
const { STATE_KEY_PREFIX } = require('../constants/EpcisConstants');
const ShipmentReceiptDivergenceRule = require('./rules/ShipmentReceiptDivergenceRule');

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
        const state = await HistoryStore.queryLatest(ctx, 'productState', [epc], 'lastEventTime');
        if (!state) throw new Error(`No state found for EPC: ${epc}`);
        return JSON.stringify(state);
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

        // FIX (22/09): proactively scan for shipped-but-never-received lots.
        // Without this, ShipmentReceiptDivergenceRule only caught divergence
        // when a coincidental later event arrived for the same lot, causing
        // silent misses (detection rates as low as 3.1% on some medications).
        summary.pendingShipmentDivergences =
            await ShipmentReceiptDivergenceRule.auditPendingShipments(ctx);

        return JSON.stringify(summary);
    }
}

module.exports = LogisticDiversionContract;
