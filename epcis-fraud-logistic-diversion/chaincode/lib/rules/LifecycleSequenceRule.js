'use strict';
 
const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');

const { ErrorCode }                = require('../../constants/EpcisConstants');

const { SKIPPED_STEP_SCORE }       = require('../../constants/RuleThresholdsConfig');
 
const LIFECYCLE   = ['commissioning', 'packing', 'shipping', 'receiving'];

const KEY_PREFIX  = 'lifecycle_';

const NOT_STARTED = -1;
 
async function lastStepIndex(ctx, epc) {

    const bytes = await ctx.stub.getState(KEY_PREFIX + epc);

    return bytes && bytes.length ? JSON.parse(bytes.toString()).step : NOT_STARTED;

}
 
class LifecycleSequenceRule extends TaxonomyRule {

    constructor() {

        super('LifecycleSequenceRule', 'Detects an EPC that skips a lifecycle step (e.g. packed without commissioning)');

    }
 
    async evaluate(ctx, event) {

        const step = LIFECYCLE.indexOf(event.bizStep);

        if (event.type !== 'ObjectEvent' || step < 0) return RuleResult.pass();

        for (const epc of (event.epcList || [])) {

            const prev = await lastStepIndex(ctx, epc);

            if (step !== 0 && step !== prev + 1) {

                return RuleResult.fail(ErrorCode.SKIPPED_LIFECYCLE_STEP,

                    `EPC ${epc}: '${event.bizStep}' not preceded by '${LIFECYCLE[step - 1]}'`,

                    SKIPPED_STEP_SCORE, { epc });

            }

        }

        return RuleResult.pass();

    }
 
    static async updateLifecycleState(ctx, event) {

        const step = LIFECYCLE.indexOf(event.bizStep);

        if (event.type !== 'ObjectEvent' || step < 0) return;

        for (const epc of (event.epcList || [])) {

            await ctx.stub.putState(KEY_PREFIX + epc, Buffer.from(JSON.stringify({ step })));

        }

    }

}
 
module.exports = LifecycleSequenceRule;

