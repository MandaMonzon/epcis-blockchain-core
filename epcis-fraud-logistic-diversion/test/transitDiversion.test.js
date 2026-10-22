'use strict';

const { expect } = require('chai');
const RuleEngine = require('../chaincode/lib/RuleEngine');
const { makeCtx, makeEvent } = require('./helpers');

const EPC = 'urn:epc:id:sgtin:0614141.107346.900000000001';
const DESTINATION = 'urn:epc:id:sgln:us.dea.BR4849709.0.0';
const WRONG_LOCATION = 'urn:epc:id:sgln:us.dea.BR0000001.0.0';

const asDocument = id => ({ id });
const asContractInput = id => id;

async function receiveAt(location, shape) {
    const ctx = makeCtx();
    const base = { epcList: [EPC], bizLocation: shape('urn:epc:id:sgln:4000001.00000.0') };
    const steps = [
        { bizStep: 'commissioning', eventTime: '2024-01-01T00:00:00Z' },
        { bizStep: 'packing', eventTime: '2024-01-01T01:00:00Z' },
        {
            bizStep: 'shipping',
            eventTime: '2024-01-02T00:00:00Z',
            destinationList: [{ type: 'location', destination: DESTINATION }],
        },
        { bizStep: 'receiving', eventTime: '2024-01-10T00:00:00Z', bizLocation: shape(location) },
    ];
    let result;
    for (const [i, step] of steps.entries()) {
        result = await RuleEngine.evaluate(ctx, makeEvent({ eventID: `urn:uuid:transit-${i}`, ...base, ...step }));
    }
    return result.violations.filter(v => v.code === 'TRANSIT_DIVERSION');
}

describe('TransitDiversionRule — Class B', () => {
    it('flags a receiving at a location other than the shipped destination (EPCIS document shape)', async () => {
        expect(await receiveAt(WRONG_LOCATION, asDocument)).to.not.be.empty;
    });

    it('flags it when the contract has flattened bizLocation to a string', async () => {
        expect(await receiveAt(WRONG_LOCATION, asContractInput)).to.not.be.empty;
    });

    it('accepts a receiving at the shipped destination (both shapes)', async () => {
        expect(await receiveAt(DESTINATION, asDocument)).to.be.empty;
        expect(await receiveAt(DESTINATION, asContractInput)).to.be.empty;
    });
});
