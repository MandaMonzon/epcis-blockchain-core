
'use strict';
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const { ErrorCode }                = require('../../constants/EpcisConstants');

const { SKIPPED_STEP_SCORE }       = require('../../constants/RuleThresholdsConfig');
 
const REQUIRED_BEFORE_RECEIVING = ['commissioning', 'packing', 'shipping'];

const KEY_PREFIX                = 'lifecycle_';
 
async function stepsSeen(ctx, epc) {

    const bytes = await ctx.stub.getState(KEY_PREFIX + epc);

    return bytes && bytes.length ? JSON.parse(bytes.toString()).seen : [];

}
 
class LifecycleSequenceRule extends TaxonomyRule {

    constructor() {

        super('LifecycleSequenceRule', 'Detects an EPC received without having gone through every earlier lifecycle step');

    }
 
    async evaluate(ctx, event) {

        if (event.type !== 'ObjectEvent' || event.bizStep !== 'receiving') return RuleResult.pass();

        for (const epc of (event.epcList || [])) {

            const seen    = await stepsSeen(ctx, epc);

            const missing = REQUIRED_BEFORE_RECEIVING.filter(step => !seen.includes(step));

            if (missing.length > 0) {

                return RuleResult.fail(ErrorCode.SKIPPED_LIFECYCLE_STEP,

                    `EPC ${epc} received without prior step(s): ${missing.join(', ')}`,

                    SKIPPED_STEP_SCORE, { epc, missing });

            }

        }

        return RuleResult.pass();

    }
 
    static async updateLifecycleState(ctx, event) {

        if (event.type !== 'ObjectEvent' || !event.bizStep) return;

        for (const epc of (event.epcList || [])) {

            const seen = await stepsSeen(ctx, epc);

            if (seen.includes(event.bizStep)) continue;

            seen.push(event.bizStep);

            await ctx.stub.putState(KEY_PREFIX + epc, Buffer.from(JSON.stringify({ seen })));

        }

    }

}
 
module.exports = LifecycleSequenceRule;

