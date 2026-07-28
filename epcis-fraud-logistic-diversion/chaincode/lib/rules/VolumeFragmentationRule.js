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

const WINDOW_DAYS       = 30;
const WINDOW_MS         = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const FRAGMENTATION_KEY = 'vol_frag_';

// Scores come from RiskScoreConfig.js — edit there to recalibrate
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
            // GS1 CBV: sourceList uses "source" field (not "value")
            const srcId  = String(src.source || src.value || '').trim();
            if (!srcId) continue;

            // Key: buyer + source pair
            const key        = FRAGMENTATION_KEY + event.bizLocation + '_' + srcId;
            const stateBytes = await ctx.stub.getState(key);
            const state      = (stateBytes && stateBytes.length > 0)
                ? JSON.parse(stateBytes.toString())
                : { timestamps: [] };

            // Keep only timestamps within the rolling window
            const recent = state.timestamps.filter(t => t >= cutoff);
            const count  = recent.length + 1; // +1 for the current event

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

    /** Appends the current event time to the fragmentation history. */
    static async updateFragmentationState(ctx, event) {
        if (!RECEIVING_STEPS.has(event.bizStep)) return;
        if (!event.bizLocation || !Array.isArray(event.sourceList)) return;

        const eventTime = new Date(event.eventTime).getTime();
        if (isNaN(eventTime)) return;

        const cutoff = eventTime - WINDOW_MS;

        for (const src of event.sourceList) {
            const srcId = String(src.source || src.value || '').trim();
            if (!srcId) continue;

            const key        = FRAGMENTATION_KEY + event.bizLocation + '_' + srcId;
            const stateBytes = await ctx.stub.getState(key);
            const state      = (stateBytes && stateBytes.length > 0)
                ? JSON.parse(stateBytes.toString())
                : { timestamps: [] };

            // Append and prune old timestamps outside the window
            state.timestamps = [...state.timestamps.filter(t => t >= cutoff), eventTime];
            await ctx.stub.putState(key, Buffer.from(JSON.stringify(state)));
        }
    }
}

module.exports = VolumeFragmentationRule;
