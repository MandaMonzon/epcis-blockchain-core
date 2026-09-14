
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

        if (event.disposition && BLOCKED_DISPOSITIONS.has(event.disposition)) {

            return RuleResult.fail(

                ErrorCode.LOGISTICS_DIVERSION_BLOCKED_DISPOSITION,

                `Disposition '${event.disposition}' is blocked — product cannot be moved at bizStep '${event.bizStep}'`,

                BLOCKED_DISPOSITION

            );

        }
 
        for (const epc of (event.epcList || [])) {

            const prev = await HistoryStore.queryLatest(ctx, OBJECT_TYPE, [epc], 'lastEventTime');

            if (!prev) continue;
 
            const allowedNext = AUTHORIZED_TRANSITIONS[prev.lastBizStep];

            if (allowedNext !== undefined && !allowedNext.includes(event.bizStep)) {

                return RuleResult.fail(

                    ErrorCode.LOGISTICS_DIVERSION_SEQUENCE,

                    `Invalid sequence for ${epc}: '${prev.lastBizStep}' → '${event.bizStep}' is not allowed`,

                    INVALID_SEQUENCE

                );

            }
 
            if (prev.lastEventTime && new Date(event.eventTime) < new Date(prev.lastEventTime)) {

                return RuleResult.fail(

                    ErrorCode.LOGISTICS_DIVERSION_TIMING,

                    `Out-of-order event for ${epc}: ${event.eventTime} is before last recorded ${prev.lastEventTime}`,

                    OUT_OF_ORDER

                );

            }
 
            if (prev.disposition && BLOCKED_DISPOSITIONS.has(prev.disposition)) {

                return RuleResult.fail(

                    ErrorCode.LOGISTICS_DIVERSION_BLOCKED_STATUS,

                    `${epc} has recorded disposition '${prev.disposition}' and cannot proceed to '${event.bizStep}'`,

                    BLOCKED_STATUS

                );

            }

        }
 
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
 
    static async updateProductState(ctx, event) {

        if (!Array.isArray(event.epcList)) return;

        for (const epc of event.epcList) {

            const prev = await HistoryStore.queryLatest(ctx, OBJECT_TYPE, [epc], 'lastEventTime');

            await HistoryStore.append(ctx, OBJECT_TYPE, [epc, event.eventID], {

                lastBizStep:   event.bizStep,

                lastEventTime: event.eventTime,

                lastLocation:  event.bizLocation || null,

                disposition:   event.disposition || (prev && prev.disposition) || null,

            });

        }

    }

}
 
function extractJurisdiction(list) {

    if (!Array.isArray(list)) return null;

    for (const entry of list) {

        const val = String(entry.source || entry.destination || entry.value || '').toLowerCase();

        if (val.includes('eu.') || val.includes('.eu')) return 'EU';

        if (val.includes('us.') || val.includes('.us')) return 'US';

    }

    return null;

}
 
module.exports = LogisticsDiversionRule;

