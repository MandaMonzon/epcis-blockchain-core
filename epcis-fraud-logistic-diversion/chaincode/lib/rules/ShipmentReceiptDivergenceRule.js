'use strict';

/**
 * Class B — Shipment Receipt Divergence Rule
 * ============================================
 * Detects divergence between a seller's despatch advice (TransactionEvent
 * with type=desadv) and the buyer's receiving confirmation (TransactionEvent
 * with type=recadv) for the same lot.
 *
 * SCENARIO
 * --------
 * A seller emits a TransactionEvent (desadv) confirming shipment of a lot.
 * The buyer never emits a corresponding TransactionEvent (recadv) confirming
 * receipt. This means the product was documented as shipped but no party
 * confirmed it arrived — a strong signal of logistics diversion or cargo theft.
 *
 * DETECTION LOGIC
 * ---------------
 * 1. On TransactionEvent (type=desadv, bizStep=shipping):
 *    Save { shipped: true, destination, shipTime, sgtins[] } under key
 *    ship_div_{txnId} in the ledger.
 *
 * 2. On TransactionEvent (type=recadv, bizStep=receiving):
 *    Mark the lot as confirmed. No violation.
 *
 * 3. On any subsequent ObjectEvent for EPCs from a lot that has a desadv
 *    but no recadv after the expected transit window (TRANSIT_DAYS_MAX):
 *    Fire SHIPMENT_DIVERGENCE.
 *
 * NOTE: In the simulation context, divergence is flagged on the next
 * ObjectEvent after the expected receiving date if no recadv was seen.
 * This avoids requiring a timeout mechanism in the smart contract.
 *
 * REGULATORY BASIS
 * ----------------
 * DSCSA 21 USC §360eee-1(c)(1):
 *   Trading partners must respond to suspect product notifications —
 *   absence of receiving confirmation is a suspect product indicator.
 *
 * GS1 EPCIS 2.0 — TransactionEvent:
 *   https://ref.gs1.org/standards/epcis (Section 7.4)
 * GS1 CBV 2.0 — bizTransactionList types:
 *   urn:epcglobal:cbv:btt:desadv — Despatch Advice (seller confirms shipment)
 *   urn:epcglobal:cbv:btt:recadv — Receiving Advice (buyer confirms receipt)
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode }                 = require('../../constants/EpcisConstants');
const { SHIPMENT_DIVERGENCE }       = require('../../constants/RiskScoreConfig');

const SHIP_DIV_KEY      = 'ship_div_';
const TRANSIT_DAYS_MAX  = 30; // days: after this window, missing recadv is suspicious

class ShipmentReceiptDivergenceRule extends TaxonomyRule {
    constructor() {
        super(
            'ShipmentReceiptDivergenceRule',
            'Detects missing receiving confirmation after a despatch advice was issued (TransactionEvent desadv without recadv)'
        );
    }

    async evaluate(ctx, event) {
        const txnId = extractTxnId(event);
        if (!txnId) return RuleResult.pass();

        // ── TransactionEvent handling ─────────────────────────────────────────
        if (event.type === 'TransactionEvent') {
            const bizTransType = extractBizTransType(event);

            if (bizTransType === 'urn:epcglobal:cbv:btt:desadv') {
                // Seller emitted despatch advice — save state, no violation yet
                return RuleResult.pass(); // state saved in updateShipmentState()
            }

            if (bizTransType === 'urn:epcglobal:cbv:btt:recadv') {
                // Buyer confirmed receipt — mark lot as received, no violation
                return RuleResult.pass(); // state update clears the pending flag
            }
        }

        // ── ObjectEvent: check if lot was shipped but never confirmed received ─
        if (event.type === 'ObjectEvent' && event.bizStep === 'receiving') {
            // A receiving ObjectEvent exists — this is NOT divergence
            return RuleResult.pass();
        }

        // For any other ObjectEvent after shipping window: check for unconfirmed lot
        if (event.type === 'ObjectEvent') {
            const key        = SHIP_DIV_KEY + txnId;
            const stateBytes = await ctx.stub.getState(key);
            if (!stateBytes || stateBytes.length === 0) return RuleResult.pass();

            const state = JSON.parse(stateBytes.toString());
            if (!state.shipped || state.received) return RuleResult.pass();

            // Check if transit window has elapsed
            const shipTime = new Date(state.shipTime);
            const now      = new Date(event.eventTime || Date.now());
            const daysDiff = (now - shipTime) / (1000 * 60 * 60 * 24);

            if (daysDiff > TRANSIT_DAYS_MAX) {
                return RuleResult.fail(
                    ErrorCode.SHIPMENT_DIVERGENCE,
                    `Lot '${txnId}' was shipped (desadv at ${state.shipTime}) but no receiving ` +
                    `confirmation (recadv) after ${Math.round(daysDiff)} days — possible cargo theft or diversion`,
                    SHIPMENT_DIVERGENCE,
                    { daysSinceShipment: Math.round(daysDiff), destination: state.destination }
                );
            }
        }

        return RuleResult.pass();
    }

    /**
     * Saves or updates shipment/receiving state for a lot.
     * Called by RuleEngine after Class B evaluation.
     */
    static async updateShipmentState(ctx, event) {
        const txnId = extractTxnId(event);
        if (!txnId) return;

        if (event.type !== 'TransactionEvent') return;

        const bizTransType = extractBizTransType(event);
        const key          = SHIP_DIV_KEY + txnId;
        const stateBytes   = await ctx.stub.getState(key);
        const state        = (stateBytes && stateBytes.length > 0)
            ? JSON.parse(stateBytes.toString())
            : { shipped: false, received: false };

        if (bizTransType === 'urn:epcglobal:cbv:btt:desadv') {
            state.shipped     = true;
            state.shipTime    = event.eventTime || null;
            state.destination = extractDestination(event);
        } else if (bizTransType === 'urn:epcglobal:cbv:btt:recadv') {
            state.received    = true;
            state.receiveTime = event.eventTime || null;
        }

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
    }
}

function extractTxnId(event) {
    const ilmd = event.ilmd || {};
    return (ilmd['cbvmda:transactionID'] || ilmd['cbvmda:lotNumber'] || '').trim() || null;
}

function extractBizTransType(event) {
    const list = event.bizTransactionList || [];
    return list.length > 0 ? (list[0].type || '') : '';
}

function extractDestination(event) {
    const dest = event.destinationList || [];
    const loc  = dest.find(d => d.type === 'location');
    return loc ? (loc.destination || '') : '';
}

module.exports = ShipmentReceiptDivergenceRule;
