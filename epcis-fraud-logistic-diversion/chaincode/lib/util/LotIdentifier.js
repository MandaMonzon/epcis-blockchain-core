'use strict';

/**
 * LotIdentifier
 * =============
 * Single source of truth for resolving the "lot" (manufacturing batch)
 * identifier of an EPCIS event's ILMD block.
 *
 * FIXED 25/09 — CORRECTED PRECEDENCE
 * -----------------------------------
 * Previously, rules read `cbvmda:transactionID` first and only fell back to
 * `cbvmda:lotNumber` if it was absent. Because the event generator used to
 * set both fields to the same value (transaction_id), this bug was invisible.
 *
 * Now that the generator (scenario_builder.py, see item 8 of its docstring)
 * produces a real, independent lot_number — shared by MULTIPLE transactions
 * of the same drug — `cbvmda:lotNumber` is the correct semantic identifier
 * for "which manufacturing batch does this event belong to". Using
 * `transactionID` as the primary key would keep testing lot-level rules
 * (LotContaminationRule, ShipmentReceiptDivergenceRule) in a degenerate 1:1
 * mode where "lot" == "single shipment", never exercising true cross-shipment
 * contamination as intended by DSCSA 21 USC §360eee-1(c).
 *
 * Precedence: cbvmda:lotNumber -> cbvmda:transactionID -> null.
 * The transactionID fallback keeps backward compatibility with older
 * datasets that never populated lotNumber independently.
 */

/**
 * Extracts the lot identifier from an EPCIS event.
 * @param {object} event - EPCIS event with an optional `ilmd` block.
 * @returns {string|null} trimmed lot identifier, or null if none present.
 */
function extractLotId(event) {
    const ilmd = event.ilmd || {};
    const lotNumber    = (ilmd['cbvmda:lotNumber'] || '').trim();
    const transactionId = (ilmd['cbvmda:transactionID'] || '').trim();
    return lotNumber || transactionId || null;
}

module.exports = { extractLotId };
