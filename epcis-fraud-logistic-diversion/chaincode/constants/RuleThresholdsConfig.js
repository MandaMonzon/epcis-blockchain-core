'use strict';

/**
 * RuleThresholdsConfig.js
 * =======================
 * Single source of truth for all OPERATIONAL thresholds used by Class B
 * rules (windows, tolerances, order-count limits). Risk SCORES live in
 * RiskScoreConfig.js — this file is only about the numeric conditions that
 * decide WHEN a rule fires, not how many points it awards.
 *
 * WHY THIS FILE EXISTS (found 22/09 while cross-checking
 * Relatorio_Fontes_Blockchain.docx against the rule source code):
 * several of these thresholds were hardcoded directly inside each rule file
 * with no single place to review/recalibrate them, and at least two had no
 * defensible source (see comments below). Centralizing them here does not
 * fix the calibration problem by itself, but makes it visible and testable
 * in one place instead of scattered across 7 files.
 *
 * @typedef {Object} RuleThresholds
 * @property {number} quantityDiscrepancyTolerancePct  - B3: max acceptable loss rate (0-1)
 * @property {number} shipmentTransitDaysMax           - B4: days before missing recadv is flagged
 * @property {number} volumeFragmentationWindowDays    - B7: rolling window for order counting
 * @property {{min:number, label:string}[]} volumeFragmentationFixedThresholds - B7: legacy fixed limits
 * @property {number} volumeFragmentationRobustMultiplier - B7: multiplier over median for the robust method
 */

/** @type {RuleThresholds} */
const RuleThresholdsConfig = Object.freeze({

    // ── B3 — QuantityDiscrepancyRule ────────────────────────────────────────
    // Original value: 0.10 (10%), no cited source (flagged in
    // Relatorio_Fontes_Blockchain.docx as "A DEFINIR O PORQUÊ").
    // MANTIDO EM 0.10 — não alterei o comportamento, só centralizei o valor
    // aqui. Real-world tolerance per USP <797> + industry SOP guidance is
    // 0.5%-1%, bem mais rígido — mas essa mudança de valor precisa ser
    // decidida e testada por vocês antes de ir para produção, não decidi
    // isso sozinho.
    // TODO(pesquisa): re-run comparando 0.10 vs 0.01 e ver quantas
    // transações mudam de classificação (ver seção de análise no relatório).
    QUANTITY_DISCREPANCY_TOLERANCE_PCT: 0.10,

    // ── B4 — ShipmentReceiptDivergenceRule ──────────────────────────────────
    // Original value: 30 days, no cited source (flagged in
    // Relatorio_Fontes_Blockchain.docx: "não existe prazo de 30 dias na lei;
    // prática real recomenda resolver em poucos dias"). No exact number is
    // published, so this is a judgment call, not a sourced constant — kept
    // configurable here specifically so it can be re-run at 3/5/7/30 days
    // for a sensitivity comparison instead of being buried in the rule file.
    SHIPMENT_TRANSIT_DAYS_MAX: 30,

    // ── B7 — VolumeFragmentationRule ────────────────────────────────────────
    VOLUME_FRAGMENTATION_WINDOW_DAYS: 30,

    // Legacy fixed limits (no published source — DEA SORS confirms the
    // pattern but not these specific numbers). Kept only for backward
    // comparison against the new robust-statistic method below.
    VOLUME_FRAGMENTATION_FIXED_THRESHOLDS: [
        { min: 20, label: 'HIGH' },
        { min: 10, label: 'ELEVATED' },
    ],

    // DEA SORS-recommended approach: compare each supplier against its own
    // historical monthly order median using a robust statistic (median +
    // median absolute deviation, MAD), instead of one fixed limit for every
    // supplier. Multiplier below is the "2x-3x above median" rule of thumb
    // cited in Relatorio_Fontes_Blockchain.docx — still a judgment call
    // pending validation, not a published exact number.
    VOLUME_FRAGMENTATION_ROBUST_MULTIPLIER: 2,
});

module.exports = RuleThresholdsConfig;
