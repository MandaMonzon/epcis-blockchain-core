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
const RuleThresholdsConfig = require('../../constants/RuleThresholdsConfig');
const HistoryStore = require('../util/HistoryStore');

const WINDOW_DAYS  = RuleThresholdsConfig.VOLUME_FRAGMENTATION_WINDOW_DAYS;
const WINDOW_MS    = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const OBJECT_TYPE  = 'fragmentation';

// Scores come from RiskScoreConfig.js — edit there to recalibrate
// Legacy fixed limits — no published source (DEA SORS confirms the pattern,
// not these numbers). Kept for backward comparison against the robust
// method below (see computeRobustFlag).
const THRESHOLDS = [
    { min: RuleThresholdsConfig.VOLUME_FRAGMENTATION_FIXED_THRESHOLDS[0].min, score: FRAGMENTATION_HIGH,     label: 'HIGH'     },
    { min: RuleThresholdsConfig.VOLUME_FRAGMENTATION_FIXED_THRESHOLDS[1].min, score: FRAGMENTATION_ELEVATED, label: 'ELEVATED' },
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
            const count   = recent.length + 1; // +1 for the current event

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

    /**
     * Appends a new immutable timestamp record per receiving event — no
     * shared array to read-modify-write, so concurrent receiving events for
     * the same buyer/source pair never collide.
     */
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

/** GS1 CBV: sourceList uses "source" field (not "value"). */
function extractSourceId(src) {
    return String(src.source || src.value || '').trim();
}

module.exports = VolumeFragmentationRule;
