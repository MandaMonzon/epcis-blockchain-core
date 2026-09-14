
'use strict';
 
/**

* Class B — Supply Base Complexity Rule

* =======================================

* Detects diversion risk when a single pharmacy/buyer receives from too many

* distinct distributors — a known pattern for hiding diversion.

*

* Empirical thresholds from Skilton et al. (2024), ARCOS/DEA data (2006–2019):

*   Mean:           3.12 suppliers per pharmacy

*   Std deviation:  1.44

*   99th percentile: ≥ 9 suppliers → critical diversion risk

*

*   +1 supplier ≈ +290,000 MME diversion risk per year (within-firm effect)

*

* Score:

*   ≤ 3 suppliers → 0   (normal)

*   4–5 suppliers → 30  (elevated, above mean + 1 SD)

*   6–8 suppliers → 60  (high)

*   ≥ 9 suppliers → 85  (critical, 99th percentile)

*

* Reference:

*   Skilton, P.F. et al. (2024). Supply base attributes and diversion risk

*   in a supply chain for hazardous pharmaceutical products.

*   Journal of Operations Management, 71(3), 373–392.

*   https://doi.org/10.1002/joom.1335

*/
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const HistoryStore = require('../util/HistoryStore');

const { ErrorCode, BizStep } = require('../../constants/EpcisConstants');

const { SUPPLY_ELEVATED, SUPPLY_HIGH, SUPPLY_CRITICAL } = require('../../constants/RiskScoreConfig');
 
const OBJECT_TYPE = 'supplyComplexity';
 
const THRESHOLDS = [

    { min: 9, score: SUPPLY_CRITICAL,  label: 'CRITICAL'  },

    { min: 6, score: SUPPLY_HIGH,      label: 'HIGH'      },

    { min: 4, score: SUPPLY_ELEVATED,  label: 'ELEVATED'  },

];
 
const RECEIVING_STEPS = new Set([BizStep.RECEIVING, BizStep.STOCKING, BizStep.DISPENSING]);
 
class SupplyBaseComplexityRule extends TaxonomyRule {

    constructor() {

        super(

            'SupplyBaseComplexityRule',

            'Detects diversion risk from too many distinct suppliers at one buyer location (Class B, Skilton 2024)'

        );

    }
 
    async evaluate(ctx, event) {

        if (!RECEIVING_STEPS.has(event.bizStep))                                   return RuleResult.pass();

        if (!event.bizLocation)                                                    return RuleResult.pass();

        if (!Array.isArray(event.sourceList) || event.sourceList.length === 0)    return RuleResult.pass();
 
        const suppliers = await HistoryStore.queryAll(ctx, OBJECT_TYPE, [event.bizLocation]);

        const supplierSet = new Set(suppliers.map(s => s.supplierId));

        for (const src of event.sourceList) {

            const id = extractSupplierId(src);

            if (id) supplierSet.add(id);

        }
 
        const count = supplierSet.size;

        for (const { min, score, label } of THRESHOLDS) {

            if (count >= min) {

                return RuleResult.fail(

                    ErrorCode.SUPPLY_BASE_COMPLEXITY,

                    `${label}: buyer '${event.bizLocation}' has ${count} distinct suppliers ` +

                    `(threshold: ${min}). Skilton et al. (2024): +1 supplier ≈ +290,000 MME/year diversion risk.`,

                    score,

                    { supplierCount: count }

                );

            }

        }
 
        return RuleResult.pass();

    }
 
    static async updateComplexityState(ctx, event) {

        if (!event.bizLocation || !Array.isArray(event.sourceList)) return;
 
        for (const src of event.sourceList) {

            const id = extractSupplierId(src);

            if (!id) continue;

            await HistoryStore.append(ctx, OBJECT_TYPE, [event.bizLocation, id], {

                supplierId:  id,

                lastUpdated: event.eventTime,

            });

        }

    }

}
 
function extractSupplierId(src) {

    return String(src.source || src.value || src.type || '').trim();

}
 
module.exports = SupplyBaseComplexityRule;

