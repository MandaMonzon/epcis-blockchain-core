
'use strict';
 
/**

* Class B — Transit Time Rule

* Flags a receiving ObjectEvent that happens implausibly soon after the

* shipping event of the same EPC (transit shorter than MIN_TRANSIT_DAYS).

* Reads the shipTime stored by TransitDiversionRule.updateTransitState.

*/
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const { ErrorCode }                = require('../../constants/EpcisConstants');

const { TRANSIT_DIVERSION }        = require('../../constants/RiskScoreConfig');

const RuleThresholdsConfig         = require('../../constants/RuleThresholdsConfig');
 
const DAY_MS             = 24 * 60 * 60 * 1000;

const TRANSIT_KEY_PREFIX = 'transit_dest_';

const MIN_TRANSIT_DAYS   = RuleThresholdsConfig.MIN_TRANSIT_DAYS;
 
class TransitTimeRule extends TaxonomyRule {

    constructor() {

        super('TransitTimeRule', 'Detects receiving implausibly soon after shipping (impossible transit time)');

    }
 
    async evaluate(ctx, event) {

        if (event.type !== 'ObjectEvent' || event.bizStep !== 'receiving') return RuleResult.pass();

        const received = new Date(event.eventTime).getTime();

        if (isNaN(received)) return RuleResult.pass();
 
        for (const epc of (event.epcList || [])) {

            const bytes = await ctx.stub.getState(TRANSIT_KEY_PREFIX + epc);

            if (!bytes || bytes.length === 0) continue;

            const shipped = new Date(JSON.parse(bytes.toString()).shipTime).getTime();

            if (isNaN(shipped)) continue;

            const days = (received - shipped) / DAY_MS;

            if (days >= 0 && days < MIN_TRANSIT_DAYS) {

                return RuleResult.fail(

                    ErrorCode.IMPOSSIBLE_TRANSIT_TIME,

                    `EPC ${epc}: received ${days.toFixed(1)} day(s) after shipping (minimum ${MIN_TRANSIT_DAYS})`,

                    TRANSIT_DIVERSION,

                    { transitDays: days }

                );

            }

        }

        return RuleResult.pass();

    }

}
 
module.exports = TransitTimeRule;

