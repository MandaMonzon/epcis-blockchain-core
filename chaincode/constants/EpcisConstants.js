'use strict';

/**
 * EpcisConstants.js
 * =================
 * Single source of truth for all GS1 EPCIS 2.0 / CBV vocabulary values
 * and ledger key prefixes used across all chaincode modules.
 *
 * References:
 *   GS1 CBV 2.0: https://ref.gs1.org/standards/cbv
 */

// Ledger key prefixes — every state entry uses one of these
const STATE_KEY_PREFIX = {
    EVENT:          'event_',          // stores the full event JSON by eventID
    PRODUCT:        'product_state_',  // stores the latest state per EPC/SGTIN
    COMPLEXITY:     'supply_complexity_', // tracks supplier count per buyer location
};

// GS1 CBV 2.0 bizStep values (authorized steps in the pharmaceutical chain)
const BizStep = {
    COMMISSIONING:    'commissioning',
    PACKING:          'packing',
    SHIPPING:         'shipping',
    RECEIVING:        'receiving',
    INSPECTING:       'inspecting',
    STOCKING:         'stocking',
    DISPENSING:       'dispensing',
    HOLDING:          'holding',
    DECOMMISSIONING:  'decommissioning',
    DESTROYING:       'destroying',
};

// GS1 CBV 2.0 disposition values that block further distribution
const BLOCKED_DISPOSITIONS = new Set([
    'recalled',
    'damaged',
    'expired',
    'stolen',
    'destroyed',
    'non_conformant',
]);

// Valid bizStep transitions — key: current step, value: allowed next steps
// Based on GS1 pharmaceutical CBV guidelines
const AUTHORIZED_TRANSITIONS = {
    [BizStep.COMMISSIONING]:   [BizStep.PACKING, BizStep.SHIPPING],
    [BizStep.PACKING]:         [BizStep.SHIPPING],
    [BizStep.SHIPPING]:        [BizStep.RECEIVING, BizStep.DECOMMISSIONING, BizStep.HOLDING],
    [BizStep.RECEIVING]:       [BizStep.INSPECTING, BizStep.STOCKING, BizStep.SHIPPING, BizStep.DISPENSING],
    [BizStep.INSPECTING]:      [BizStep.STOCKING, BizStep.HOLDING, BizStep.DECOMMISSIONING],
    [BizStep.STOCKING]:        [BizStep.DISPENSING, BizStep.SHIPPING],
    [BizStep.DISPENSING]:      [BizStep.DECOMMISSIONING, BizStep.DESTROYING],
    [BizStep.HOLDING]:         [BizStep.SHIPPING, BizStep.INSPECTING, BizStep.DECOMMISSIONING],
    [BizStep.DECOMMISSIONING]: [],
    [BizStep.DESTROYING]:      [],
};

// bizSteps where cross-jurisdiction transfer is allowed (e.g. EU → US)
const CROSS_JURISDICTION_STEPS = new Set([BizStep.SHIPPING]);

// Error codes returned in rule results (used in tests and audit logs)
const ErrorCode = {
    MISSING_FIELD:                       'MISSING_FIELD',
    DUPLICATE_EVENT:                     'DUPLICATE_EVENT',
    EVENT_TIME_INVALID:                  'EVENT_TIME_INVALID',
    LOGISTICS_DIVERSION_BLOCKED_STATUS:  'LOGISTICS_DIVERSION_BLOCKED_STATUS',
    LOGISTICS_DIVERSION_BLOCKED_DISPOSITION: 'LOGISTICS_DIVERSION_BLOCKED_DISPOSITION',
    LOGISTICS_DIVERSION_SEQUENCE:        'LOGISTICS_DIVERSION_SEQUENCE',
    LOGISTICS_DIVERSION_TIMING:          'LOGISTICS_DIVERSION_TIMING',
    LOGISTICS_DIVERSION_JURISDICTION:    'LOGISTICS_DIVERSION_JURISDICTION',
    SUPPLY_BASE_COMPLEXITY:              'SUPPLY_BASE_COMPLEXITY',
    VOLUME_FRAGMENTATION:                'VOLUME_FRAGMENTATION',
};

module.exports = {
    STATE_KEY_PREFIX,
    BizStep,
    BLOCKED_DISPOSITIONS,
    AUTHORIZED_TRANSITIONS,
    CROSS_JURISDICTION_STEPS,
    ErrorCode,
};
