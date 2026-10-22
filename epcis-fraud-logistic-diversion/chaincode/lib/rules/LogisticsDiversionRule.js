
'use strict';
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const HistoryStore = require('../util/HistoryStore');

const {

    ErrorCode,

    AUTHORIZED_TRANSITIONS,

    BLOCKED_DISPOSITIONS,

    CROSS_JURISDICTION_STEPS,

} = require('../../constants/EpcisConstants');

const { BLOCKED_DISPOSITION, BLOCKED_STATUS, INVALID_SEQUENCE, CROSS_JURISDICTION, OUT_OF_ORDER } = require('../../constants/RiskScoreConfig');
 
const OBJECT_TYPE = 'productState';
 
class LogisticsDiversionRule extends TaxonomyRule {

    constructor() {

        super(

            'LogisticsDiversionRule',

            'Detects diversion: blocked dispositions, invalid sequences, timing violations, jurisdiction mismatches (Class B)'

        );

    }
 
    async evaluate(ctx, event) {

        event.__prevState = event.__prevState || {};
        const failures = [];

        for (const epc of (event.epcList || [])) {
            const prev = await HistoryStore.queryLatest(ctx, OBJECT_TYPE, [epc], 'lastEventTime');
            event.__prevState[epc] = prev;
            if (!prev) continue;

            const allowedNext = AUTHORIZED_TRANSITIONS[prev.lastBizStep];
            if (allowedNext !== undefined && prev.lastBizStep !== event.bizStep && !allowedNext.includes(event.bizStep)) {
                failures.push(RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_SEQUENCE,
                    `Invalid sequence for ${epc}: '${prev.lastBizStep}' → '${event.bizStep}' is not allowed`,
                    INVALID_SEQUENCE
                ));
            } else if (prev.lastEventTime && new Date(event.eventTime) < new Date(prev.lastEventTime)) {
                failures.push(RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_TIMING,
                    `Out-of-order event for ${epc}: ${event.eventTime} is before last recorded ${prev.lastEventTime}`,
                    OUT_OF_ORDER
                ));
            }
        }

        const srcJurisdiction = extractJurisdiction(event.sourceList);
        const dstJurisdiction = extractJurisdiction(event.destinationList);
        if (srcJurisdiction && dstJurisdiction && srcJurisdiction !== dstJurisdiction
            && !CROSS_JURISDICTION_STEPS.has(event.bizStep)) {
            failures.push(RuleResult.fail(
                ErrorCode.LOGISTICS_DIVERSION_JURISDICTION,
                `Cross-jurisdiction move (${srcJurisdiction} → ${dstJurisdiction}) not allowed at '${event.bizStep}'`,
                CROSS_JURISDICTION
            ));
        }

        if (failures.length === 0) return RuleResult.pass();
        return failures.reduce((worst, f) => (f.score > worst.score ? f : worst));
    }

    static async updateProductState(ctx, event) {

        if (!Array.isArray(event.epcList)) return;

        const cache = event.__prevState || {};

        for (const epc of event.epcList) {

            const prev = Object.prototype.hasOwnProperty.call(cache, epc)

                ? cache[epc]

                : await HistoryStore.queryLatest(ctx, OBJECT_TYPE, [epc], 'lastEventTime');

            await HistoryStore.append(ctx, OBJECT_TYPE, [epc, event.eventID], {

                lastBizStep:   event.bizStep,

                lastEventTime: event.eventTime,

                lastLocation:  event.bizLocation || null,

                disposition:   event.disposition || (prev && prev.disposition) || null,

            });

        }

    }

}
 
// GS1 company prefixes 400-440 are allocated to Germany (EU); used when the id carries no explicit 'eu.' marker.
function isEuGs1Prefix(val) {
    const m = /:(?:sgln|pgln):(\d{3})/.exec(val);
    return !!m && Number(m[1]) >= 400 && Number(m[1]) <= 440;
}

// The jurisdiction marker is the first segment of the URN authority (for example 'us.dea.' or 'eu.gln.').
// Matching it anywhere in the identifier misreads DEA registrant numbers that start with 'EU' or 'US'.
const MARKER_JURISDICTION = { eu: 'EU', us: 'US' };

function extractJurisdiction(list) {
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
        const val = String(entry.source || entry.destination || entry.value || '').toLowerCase();
        const marker = /:(?:sgln|pgln):([a-z]{2})\./.exec(val);
        if (marker && MARKER_JURISDICTION[marker[1]]) return MARKER_JURISDICTION[marker[1]];
        if (isEuGs1Prefix(val)) return 'EU';
    }
    return null;
}

module.exports = LogisticsDiversionRule;

