'use strict';

const { Contract } = require('fabric-contract-api');
const RuleEngine = require('./RuleEngine');
const HistoryStore = require('./util/HistoryStore');
const { STATE_KEY_PREFIX } = require('../constants/EpcisConstants');
const ShipmentReceiptMismatchRule = require('./rules/ShipmentReceiptMismatchRule');

const RISK_BANDS = [
    { name: 'clean', upTo: 1 },
    { name: 'elevated', upTo: 30 },
    { name: 'high', upTo: 60 },
    { name: 'critical', upTo: 85 },
    { name: 'maxRisk', upTo: Infinity },
];

const toJsonBytes = (value) => Buffer.from(JSON.stringify(value));

function parseEvent(eventJsonStr) {
    try {
        return JSON.parse(eventJsonStr);
    } catch (error) {
        throw new Error(`INVALID_JSON: ${error.message}`);
    }
}

// EPCIS 2.0 sends bizLocation and readPoint as {"id": "urn:..."}; the rules work on plain strings.
function flattenLocations(event) {
    for (const field of ['bizLocation', 'readPoint']) {
        if (event[field] && typeof event[field] === 'object') {
            event[field] = event[field].id || '';
        }
    }
    return event;
}

function auditRecordOf(result) {
    const { accepted, eventID, epc, bizStep, riskScore, violations } = result;
    return { accepted, eventID, epc, bizStep, riskScore, violations };
}

function riskBandOf(score) {
    return RISK_BANDS.find(({ upTo }) => score < upTo).name;
}

function newSummary() {
    return {
        totalEvents: 0,
        rejectedEvents: 0,
        acceptedEvents: 0,
        riskBands: Object.fromEntries(RISK_BANDS.map(({ name }) => [name, 0])),
        violationsByRule: {},
    };
}

function addToSummary(summary, record) {
    summary.totalEvents++;
    if (!record.accepted) {
        summary.rejectedEvents++;
        return;
    }
    summary.acceptedEvents++;
    summary.riskBands[riskBandOf(record.riskScore || 0)]++;
    for (const { rule } of record.violations || []) {
        summary.violationsByRule[rule] = (summary.violationsByRule[rule] || 0) + 1;
    }
}

class LogisticDiversionContract extends Contract {
    constructor() {
        super('LogisticDiversionContract');
    }

    async submitEvent(ctx, eventJsonStr) {
        const event = flattenLocations(parseEvent(eventJsonStr));
        const result = await RuleEngine.evaluate(ctx, event);

        if (!result.accepted) {
            throw new Error(JSON.stringify({ rejected: true, ...result }));
        }

        await ctx.stub.putState(STATE_KEY_PREFIX.EVENT + event.eventID, toJsonBytes(event));
        await ctx.stub.putState(STATE_KEY_PREFIX.AUDIT + event.eventID, toJsonBytes(auditRecordOf(result)));

        return JSON.stringify(result);
    }

    async getEvent(ctx, eventId) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.EVENT + eventId);
        if (!bytes || bytes.length === 0) throw new Error(`Event not found: ${eventId}`);
        return bytes.toString();
    }

    async getProductState(ctx, epc) {
        const state = await HistoryStore.queryLatest(ctx, 'productState', [epc], 'lastEventTime');
        if (!state) throw new Error(`No state found for EPC: ${epc}`);
        return JSON.stringify(state);
    }

    async getAuditSummary(ctx) {
        const summary = newSummary();
        const iterator = await ctx.stub.getStateByRange(STATE_KEY_PREFIX.AUDIT, `${STATE_KEY_PREFIX.AUDIT}\xFF`);

        for await (const { value } of iterator) {
            addToSummary(summary, JSON.parse(value.toString()));
        }

        // A shipment with no later event for its lot is only caught by this proactive scan.
        summary.pendingShipmentMismatches = await ShipmentReceiptMismatchRule.auditPendingShipments(ctx);

        return JSON.stringify(summary);
    }
}

module.exports = LogisticDiversionContract;
