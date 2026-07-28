'use strict';

/**
 * Class A — Mandatory Fields Rule
 * =================================
 * Blocks any event that is missing required EPCIS 2.0 fields.
 * A missing field means the event cannot be traced and must be rejected.
 *
 * Required fields vary by event type (GS1 EPCIS 2.0 §7):
 *   ObjectEvent      — eventID, type, eventTime, bizStep, epcList
 *   AggregationEvent — eventID, type, eventTime, bizStep, parentID, childEPCs
 *   TransactionEvent — eventID, type, eventTime, bizStep, bizTransactionList
 */

const { TaxonomyRule, RuleResult } = require('../TaxonomyRule');
const { ErrorCode } = require('../../constants/EpcisConstants');

const REQUIRED_BY_TYPE = {
    'ObjectEvent':      ['eventID', 'type', 'eventTime', 'bizStep', 'epcList'],
    'AggregationEvent': ['eventID', 'type', 'eventTime', 'bizStep', 'parentID', 'childEPCs'],
    'TransactionEvent': ['eventID', 'type', 'eventTime', 'bizStep', 'bizTransactionList'],
};
const REQUIRED_DEFAULT = ['eventID', 'type', 'eventTime', 'bizStep'];

class MandatoryFieldsRule extends TaxonomyRule {
    constructor() {
        super('MandatoryFieldsRule', 'Blocks events with missing required EPCIS 2.0 fields (Class A)');
    }

    async evaluate(_ctx, event) {
        const required = REQUIRED_BY_TYPE[event.type] || REQUIRED_DEFAULT;
        for (const field of required) {
            const value = event[field];
            const empty = value === undefined || value === null || value === '' ||
                          (Array.isArray(value) && value.length === 0);
            if (empty) {
                return RuleResult.fail(
                    ErrorCode.MISSING_FIELD,
                    `Required field '${field}' is missing or empty in ${event.type || 'event'}`
                );
            }
        }
        return RuleResult.pass();
    }
}

module.exports = MandatoryFieldsRule;
