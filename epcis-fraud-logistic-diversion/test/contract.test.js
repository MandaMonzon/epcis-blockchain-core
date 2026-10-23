'use strict';

const { expect } = require('chai');
const LogisticDiversionContract = require('../chaincode/lib/LogisticDiversionContract');
const { makeCtx, makeEvent } = require('./helpers');

const EPC = 'urn:epc:id:sgtin:0614141.107346.900000000002';
const SENDER = 'urn:epc:id:sgln:4000001.00000.0';
const DESTINATION = 'urn:epc:id:sgln:us.dea.BR4849709.0.0';
const WRONG_LOCATION = 'urn:epc:id:sgln:us.dea.BR0000001.0.0';

async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to be rejected');
}

function lifecycle(prefix, receivedAt) {
    const base = { epcList: [EPC], bizLocation: { id: SENDER } };
    return [
        { bizStep: 'commissioning', eventTime: '2024-01-01T00:00:00Z' },
        { bizStep: 'packing', eventTime: '2024-01-01T01:00:00Z' },
        {
            bizStep: 'shipping',
            eventTime: '2024-01-02T00:00:00Z',
            destinationList: [{ type: 'location', destination: DESTINATION }],
        },
        { bizStep: 'receiving', eventTime: '2024-01-10T00:00:00Z', bizLocation: { id: receivedAt } },
    ].map((step, i) => makeEvent({ eventID: `urn:uuid:${prefix}-${i}`, ...base, ...step }));
}

async function submitAll(contract, ctx, events) {
    const results = [];
    for (const event of events) {
        results.push(JSON.parse(await contract.submitEvent(ctx, JSON.stringify(event))));
    }
    return results;
}

describe('LogisticDiversionContract', () => {
    let contract;
    let ctx;

    beforeEach(() => {
        contract = new LogisticDiversionContract();
        ctx = makeCtx();
    });

    it('rejects malformed JSON', async () => {
        const error = await rejection(contract.submitEvent(ctx, '{not json'));
        expect(error.message.startsWith('INVALID_JSON')).to.equal(true);
    });

    it('rejects an event with a missing mandatory field and writes nothing', async () => {
        const event = makeEvent({ bizStep: '' });
        const error = await rejection(contract.submitEvent(ctx, JSON.stringify(event)));
        expect(JSON.parse(error.message).rejected).to.equal(true);
        expect(ctx.stub._state.size).to.equal(0);
    });

    it('stores the event with bizLocation flattened to a string', async () => {
        const [first] = lifecycle('store', DESTINATION);
        await contract.submitEvent(ctx, JSON.stringify(first));
        const stored = JSON.parse(await contract.getEvent(ctx, first.eventID));
        expect(stored.bizLocation).to.equal(SENDER);
    });

    it('fails to read an event that was never submitted', async () => {
        const error = await rejection(contract.getEvent(ctx, 'urn:uuid:unknown'));
        expect(error.message.startsWith('Event not found')).to.equal(true);
    });

    it('scores a receiving at the wrong location as a transit diversion', async () => {
        const results = await submitAll(contract, ctx, lifecycle('diverted', WRONG_LOCATION));
        const receiving = results[results.length - 1];
        expect(receiving.riskScore).to.equal(85);
        expect(receiving.violations.map(v => v.code)).to.include('TRANSIT_DIVERSION');
    });

    it('keeps a correctly delivered lot below the flag threshold', async () => {
        const results = await submitAll(contract, ctx, lifecycle('normal', DESTINATION));
        expect(Math.max(...results.map(r => r.riskScore)) < 70).to.equal(true);
    });

    it('summarises every accepted event into exactly one risk band', async () => {
        await submitAll(contract, ctx, lifecycle('normal', DESTINATION));
        const diverted = lifecycle('diverted', WRONG_LOCATION).map(e => ({ ...e, epcList: [`${EPC}9`] }));
        await submitAll(contract, ctx, diverted);

        const summary = JSON.parse(await contract.getAuditSummary(ctx));
        const banded = Object.values(summary.riskBands).reduce((a, b) => a + b, 0);

        expect(summary.totalEvents).to.equal(8);
        expect(summary.acceptedEvents).to.equal(8);
        expect(banded).to.equal(summary.acceptedEvents);
        expect(summary.riskBands.maxRisk).to.equal(1);
        expect(summary.violationsByRule.TransitDiversionRule).to.equal(1);
    });
});
