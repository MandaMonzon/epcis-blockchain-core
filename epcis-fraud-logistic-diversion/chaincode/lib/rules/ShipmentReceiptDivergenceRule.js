'use strict';

/**
 * Class B: a desadv TransactionEvent (shipping) with no recadv (receiving) after the transit window.
 *
 * Basis: DSCSA 21 USC 360eee-1(c)(1) treats a missing receiving confirmation as a suspect product indicator.
 * GS1 CBV 2.0 bizTransaction types: urn:epcglobal:cbv:btt:desadv and urn:epcglobal:cbv:btt:recadv.
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode }                 = require('../../constants/EpcisConstants');
const { SHIPMENT_DIVERGENCE }       = require('../../constants/RiskScoreConfig');
const RuleThresholdsConfig          = require('../../constants/RuleThresholdsConfig');
const { extractLotId }              = require('../util/LotIdentifier');

const SHIP_DIV_KEY      = 'ship_div_';
// The 30-day deadline had no legal source; the window is configurable for sensitivity runs.
const TRANSIT_DAYS_MAX  = RuleThresholdsConfig.SHIPMENT_TRANSIT_DAYS_MAX;

class ShipmentReceiptDivergenceRule extends TaxonomyRule {
    constructor() {
        super(
            'ShipmentReceiptDivergenceRule',
            'Detects missing receiving confirmation after a despatch advice was issued (TransactionEvent desadv without recadv)'
        );
    }

    async evaluate(ctx, event) {
        const txnId = extractLotId(event);
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

    /** Scans every shipped lot without a recadv past the window, so a lot whose chain simply stops is still caught. */
    static async auditPendingShipments(ctx, asOfDate) {
        const now = new Date(asOfDate || Date.now());
        const pending = [];

        const iterator = await ctx.stub.getStateByRange(
            SHIP_DIV_KEY, SHIP_DIV_KEY + '\xFF'
        );
        for await (const { key, value } of iterator) {
            const state = JSON.parse(value.toString());
            if (!state.shipped || state.received) continue;

            const shipTime = new Date(state.shipTime);
            const daysDiff = (now - shipTime) / (1000 * 60 * 60 * 24);
            if (daysDiff > TRANSIT_DAYS_MAX) {
                pending.push({
                    txnId: key.slice(SHIP_DIV_KEY.length),
                    shipTime: state.shipTime,
                    destination: state.destination,
                    daysSinceShipment: Math.round(daysDiff),
                });
            }
        }
        return pending;
    }

    /**
     * Saves or updates shipment/receiving state for a lot.
     * Called by RuleEngine after Class B evaluation.
     */
    static async updateShipmentState(ctx, event) {
        const txnId = extractLotId(event);
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
