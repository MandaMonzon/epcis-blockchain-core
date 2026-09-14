
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
 
const STATE_KEY_PREFIX = {

    EVENT: 'event_',        // stores the full event JSON by eventID

    AUDIT: 'audit_result_', // stores per-event audit record for getAuditSummary

};
 
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
 
const BLOCKED_DISPOSITIONS = new Set([

    'recalled',

    'damaged',

    'expired',

    'stolen',

    'destroyed',

    'non_conformant',

]);
 
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
 
const CROSS_JURISDICTION_STEPS = new Set([BizStep.SHIPPING]);
 
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

    LOT_CONTAMINATION:                   'LOT_CONTAMINATION',

    QUANTITY_DISCREPANCY:                'QUANTITY_DISCREPANCY',

    SHIPMENT_DIVERGENCE:                 'SHIPMENT_DIVERGENCE',

    TRANSIT_DIVERSION:                   'TRANSIT_DIVERSION',

};
 
module.exports = {

    STATE_KEY_PREFIX,

    BizStep,

    BLOCKED_DISPOSITIONS,

    AUTHORIZED_TRANSITIONS,

    CROSS_JURISDICTION_STEPS,

    ErrorCode,

};

