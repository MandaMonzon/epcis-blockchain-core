'use strict';

/**
 * Class B — Transit Diversion Rule
 * ==================================
 * Detects when a product is received at a location that does not match the
 * declared destination in the seller's despatch advice (TransactionEvent desadv)
 * or the shipping ObjectEvent destinationList.
 *
 * SCENARIO
 * --------
 * A lot is shipped with destinationList pointing to buyer DEA-A.
 * The AggregationEvent DELETE (unpack) and receiving ObjectEvent arrive from
 * DEA-B — a completely different location. The product was diverted in transit.
 *
 * DETECTION LOGIC
 * ---------------
 * 1. On ObjectEvent (bizStep=shipping):
 *    Save { intendedDest } from destinationList under key transit_{epc} per EPC.
 *
 * 2. On ObjectEvent (bizStep=receiving):
 *    Compare event.bizLocation.id with saved intendedDest.
 *    If mismatch → TRANSIT_DIVERSION.
 *
 * 3. On AggregationEvent (DELETE, bizStep=receiving):
 *    Same comparison using childEPCs to look up their intended destinations.
 *
 * REGULATORY BASIS
 * ----------------
 * DSCSA 21 USC §360eee-1(c)(2):
 *   "A suspect product ... shall not be distributed until the product has been
 *    investigated and cleared, or disposed of in accordance with applicable law."
 *   Receipt at an unauthorized location constitutes a suspect product condition.
 *
 * EU Delegated Regulation 2016/161, Art. 35:
 *   "Wholesale distributors shall verify the unique identifier ... at the point
 *    of supply" — if the receiving location is not the declared destination,
 *    verification fails.
 *
 * GS1 EPCIS 2.0 — destinationList / bizLocation:
 *   https://ref.gs1.org/standards/epcis (Section 7.2)
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode }                 = require('../../constants/EpcisConstants');
const { TRANSIT_DIVERSION }         = require('../../constants/RiskScoreConfig');

const TRANSIT_KEY_PREFIX = 'transit_dest_';

class TransitDiversionRule extends TaxonomyRule {
    constructor() {
        super(
            'TransitDiversionRule',
            'Detects receiving at a location that does not match the declared shipping destination (transit diversion)'
        );
    }

    async evaluate(ctx, event) {
        // ── ObjectEvent: check receiving location vs intended destination ──────
        if (event.type === 'ObjectEvent') {
            if (event.bizStep === 'receiving') {
                const actualLocation = event.bizLocation?.id || '';
                for (const epc of (event.epcList || [])) {
                    const key        = TRANSIT_KEY_PREFIX + epc;
                    const stateBytes = await ctx.stub.getState(key);
                    if (!stateBytes || stateBytes.length === 0) continue;

                    const saved = JSON.parse(stateBytes.toString());
                    if (!saved.intendedDest) continue;

                    if (actualLocation && saved.intendedDest !== actualLocation) {
                        return RuleResult.fail(
                            ErrorCode.TRANSIT_DIVERSION,
                            `EPC ${epc}: intended destination '${saved.intendedDest}' ` +
                            `but received at '${actualLocation}' — product diverted in transit`,
                            TRANSIT_DIVERSION,
                            { intendedDest: saved.intendedDest, actualLocation }
                        );
                    }
                }
            }
        }

        // ── AggregationEvent DELETE: check unpacking location ─────────────────
        if (event.type === 'AggregationEvent' && event.action === 'DELETE') {
            const actualLocation = event.bizLocation?.id || '';
            for (const epc of (event.childEPCs || [])) {
                const key        = TRANSIT_KEY_PREFIX + epc;
                const stateBytes = await ctx.stub.getState(key);
                if (!stateBytes || stateBytes.length === 0) continue;

                const saved = JSON.parse(stateBytes.toString());
                if (!saved.intendedDest) continue;

                if (actualLocation && saved.intendedDest !== actualLocation) {
                    return RuleResult.fail(
                        ErrorCode.TRANSIT_DIVERSION,
                        `Container unpacked at wrong location — EPC ${epc} was destined for ` +
                        `'${saved.intendedDest}' but unpacked at '${actualLocation}'`,
                        TRANSIT_DIVERSION,
                        { intendedDest: saved.intendedDest, actualLocation }
                    );
                }
            }
        }

        return RuleResult.pass();
    }

    /**
     * Saves the intended destination for each EPC at shipping time.
     * Must be called by RuleEngine after Class B evaluation.
     */
    static async updateTransitState(ctx, event) {
        if (event.type !== 'ObjectEvent' || event.bizStep !== 'shipping') return;

        const intendedDest = extractIntendedDest(event);
        if (!intendedDest) return;

        for (const epc of (event.epcList || [])) {
            const key   = TRANSIT_KEY_PREFIX + epc;
            const state = {
                epc,
                intendedDest,
                shipTime:    event.eventTime || null,
                shipFrom:    event.bizLocation?.id || null,
                txnId:       event.ilmd?.['cbvmda:transactionID'] || null,
            };
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
        }
    }
}

function extractIntendedDest(event) {
    const dest = event.destinationList || [];
    const loc  = dest.find(d => d.type === 'location');
    return loc ? (loc.destination || '') : '';
}

module.exports = TransitDiversionRule;
