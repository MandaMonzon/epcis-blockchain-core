
'use strict';
 
/**

* Class B — Volume Fragmentation Rule

* =====================================

* Detects when a single buyer receives many small orders from the same source

* in a short time window — a pattern used to obscure high-volume diversion

* by splitting it into many apparently normal transactions.

*

* Logic:

*   Counts distinct receiving events per (buyer, source) pair within a

*   rolling 30-day window. If the count exceeds the threshold, the

*   risk score increases.

*

* Score thresholds:

*   ≥ 10 transactions in 30 days → +20 (elevated fragmentation)

*   ≥ 20 transactions in 30 days → +40 (high fragmentation)

*

* Reference:

*   Vanin et al. (2026) — Logistics Diversion taxonomy, Section 3.2

*   (Volume Fragmentation as a diversion concealment strategy)

*/
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const { ErrorCode, BizStep } = require('../../constants/EpcisConstants');

const { FRAGMENTATION_ELEVATED, FRAGMENTATION_HIGH } = require('../../constants/RiskScoreConfig');

const HistoryStore = require('../util/HistoryStore');
 
const WINDOW_DAYS  = 30;

const WINDOW_MS    = WINDOW_DAYS * 24 * 60 * 60 * 1000;

const OBJECT_TYPE  = 'fragmentation';
 
const THRESHOLDS = [

    { min: 20, score: FRAGMENTATION_HIGH,     label: 'HIGH'     },

    { min: 10, score: FRAGMENTATION_ELEVATED, label: 'ELEVATED' },

];
 
const RECEIVING_STEPS = new Set([BizStep.RECEIVING]);
 
class VolumeFragmentationRule extends TaxonomyRule {

    constructor() {

        super(

            'VolumeFragmentationRule',

            'Detects fragmented order patterns that may conceal large-volume diversion (Class B)'

        );

    }
 
    async evaluate(ctx, event) {

        if (!RECEIVING_STEPS.has(event.bizStep))                                 return RuleResult.pass();

        if (!event.bizLocation)                                                  return RuleResult.pass();

        if (!Array.isArray(event.sourceList) || event.sourceList.length === 0)  return RuleResult.pass();
 
        const eventTime = new Date(event.eventTime).getTime();

        if (isNaN(eventTime)) return RuleResult.pass();
 
        const cutoff = eventTime - WINDOW_MS;
 
        for (const src of event.sourceList) {

            const srcId = extractSourceId(src);

            if (!srcId) continue;
 
            const records = await HistoryStore.queryAll(ctx, OBJECT_TYPE, [event.bizLocation, srcId]);

            const recent  = records.filter(r => r.timestamp >= cutoff);

            const count   = recent.length + 1;
 
            for (const { min, score, label } of THRESHOLDS) {

                if (count >= min) {

                    return RuleResult.fail(

                        ErrorCode.VOLUME_FRAGMENTATION,

                        `${label}: buyer '${event.bizLocation}' received ${count} orders ` +

                        `from '${srcId}' in the last ${WINDOW_DAYS} days`,

                        score

                    );

                }

            }

        }
 
        return RuleResult.pass();

    }
 
    static async updateFragmentationState(ctx, event) {

        if (!RECEIVING_STEPS.has(event.bizStep)) return;

        if (!event.bizLocation || !Array.isArray(event.sourceList)) return;
 
        const eventTime = new Date(event.eventTime).getTime();

        if (isNaN(eventTime)) return;
 
        for (const src of event.sourceList) {

            const srcId = extractSourceId(src);

            if (!srcId) continue;
 
            await HistoryStore.append(ctx, OBJECT_TYPE, [event.bizLocation, srcId, event.eventID], {

                timestamp: eventTime,

            });

        }

    }

}
 
function extractSourceId(src) {

    return String(src.source || src.value || '').trim();

}
 
module.exports = VolumeFragmentationRule;

