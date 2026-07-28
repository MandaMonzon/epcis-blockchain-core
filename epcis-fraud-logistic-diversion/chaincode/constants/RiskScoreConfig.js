'use strict';

/**
 * RiskScoreConfig.js
 * ==================
 * Single source of truth for all Class B risk scores.
 *
 * Edit ONLY this file to recalibrate scores — no rule logic needs to change.
 *
 * Scoring framework
 * -----------------
 * Scores follow FDA recall classification (21 CFR §7.41) mapped to 0–100:
 *   85 → FDA Class I   : serious adverse health consequences or death
 *   60 → FDA Class II  : may cause temporary/reversible adverse consequences
 *   30 → FDA Class III : not likely to cause adverse health consequences
 *
 * Sources
 * -------
 *   FDA 21 CFR §7.41 (recall classes):
 *     https://www.law.cornell.edu/cfr/text/21/7.41
 *
 *   DSCSA 21 USC §360eee (suspect / illegitimate product):
 *     https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section360eee
 *
 *   EU Delegated Regulation 2016/161, Art. 36 (serialization / verification alert):
 *     https://eur-lex.europa.eu/eli/reg_del/2016/161/2021-10-11/eng
 *
 *   Skilton et al. (2024) — supply base complexity thresholds (empirical, ARCOS data):
 *     https://doi.org/10.1002/joom.1335
 *
 * IMPORTANT
 * ---------
 * These values are declared methodological choices pending empirical calibration
 * with real ARCOS data. Treat as configurable parameters, not ground truth.
 */

const RiskScoreConfig = {

    // ── LogisticsDiversionRule ───────────────────────────────────────────────

    // Product recalled/expired/damaged still moving in the supply chain.
    // FDA Class I — serious adverse health consequences or death.
    BLOCKED_DISPOSITION: 85,

    // Product previously recorded as recalled, continues moving after that fact.
    // Same classification as BLOCKED_DISPOSITION (FDA Class I).
    BLOCKED_STATUS: 85,

    // Product shipped without prior commissioning — serialization is missing.
    // EU FMD Art. 36: verification failure triggers mandatory alert.
    // Equivalent to FDA Class II.
    INVALID_SEQUENCE: 60,

    // Cross-jurisdiction transfer at a bizStep that doesn't authorize it.
    // DSCSA: product outside authorized distribution channel = "suspect product".
    // Equivalent to FDA Class II.
    CROSS_JURISDICTION: 60,

    // Event timestamp earlier than the previous recorded event for the same product.
    // Likely a data integrity issue; may not indicate physical diversion.
    // FDA Class III — not likely to cause adverse health consequences.
    OUT_OF_ORDER: 30,

    // ── SupplyBaseComplexityRule ─────────────────────────────────────────────
    // Thresholds from Skilton et al. (2024), Table 1 (mean=3.12, SD=1.44):

    // 4–5 suppliers: above mean + 1 SD → elevated risk.
    SUPPLY_ELEVATED: 30,

    // 6–8 suppliers: significantly above mean → high risk.
    SUPPLY_HIGH: 60,

    // ≥9 suppliers: 99th percentile → critical diversion risk.
    SUPPLY_CRITICAL: 85,

    // ── VolumeFragmentationRule ──────────────────────────────────────────────
    // Thresholds are methodological choices — no direct published source.
    // Declared as limitation; pending calibration.

    // ≥10 orders from the same source in 30 days → elevated fragmentation.
    FRAGMENTATION_ELEVATED: 30,

    // ≥20 orders from the same source in 30 days → high fragmentation.
    FRAGMENTATION_HIGH: 60,

    // ── LotContaminationRule ─────────────────────────────────────────────────
    // Added after initial experiment showed event-level Recall of 48%.
    // DSCSA 21 USC §360eee-1(c) mandates that if any unit in a lot is suspect,
    // the entire transaction is subject to quarantine.
    // Score inherited from the original triggering violation (capped here).
    LOT_CONTAMINATION: 60,

    // ── QuantityDiscrepancyRule ──────────────────────────────────────────────
    // Units packed into container ≠ units unpacked at destination.
    // Loss rate > 10% triggers this score.
    // Positioned between FDA Class I and II — physical product loss is serious
    // but not immediately life-threatening compared to recalled product movement.
    // DSCSA 21 USC §360eee-1(b)(1)(D).
    QUANTITY_DISCREPANCY: 75,

    // ── ShipmentReceiptDivergenceRule ────────────────────────────────────────
    // Seller issued despatch advice (desadv) but buyer never confirmed receipt
    // (recadv) after the maximum expected transit window (30 days).
    // Equivalent to FDA Class II — possible diversion or cargo theft.
    // DSCSA 21 USC §360eee-1(c)(1).
    SHIPMENT_DIVERGENCE: 70,

    // ── TransitDiversionRule ─────────────────────────────────────────────────
    // Product received at a location that does not match the declared destination
    // in the shipping event destinationList.
    // FDA Class I equivalent — product at unauthorized location is a direct
    // suspect product condition under DSCSA and EU FMD Art. 35.
    TRANSIT_DIVERSION: 85,

};
module.exports = RiskScoreConfig;
