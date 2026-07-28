'use strict';

/**
 * Minimal mock of Hyperledger Fabric's ctx.stub for unit tests.
 * Stores state in memory — no real blockchain needed.
 */
class MockStub {
    constructor() {
        this._state = new Map();
    }

    async getState(key) {
        const val = this._state.get(key);
        return val ? Buffer.from(val) : Buffer.from('');
    }

    async putState(key, value) {
        this._state.set(key, value.toString());
    }

    // Convenience: reset all state between tests
    reset() { this._state.clear(); }
}

function makeCtx() {
    const stub = new MockStub();
    return { stub };
}

/** Creates a minimal valid EPCIS 2.0 ObjectEvent. */
function makeEvent(overrides = {}) {
    return {
        eventID:             'urn:uuid:test-event-001',
        type:                'ObjectEvent',
        action:              'OBSERVE',
        eventTime:           '2024-01-01T10:00:00Z',
        eventTimeZoneOffset: '+00:00',
        bizStep:             'commissioning',
        disposition:         'active',
        epcList:             ['urn:epc:id:sgtin:0614141.107346.100000000001'],
        bizLocation:         'urn:epc:id:sgln:us.dea.BU0000001.0.0',
        readPoint:           'urn:epc:id:sgln:us.dea.RA0000001.0.0',
        // GS1 CBV: sourceList uses "source", destinationList uses "destination"
        sourceList:      [
            { type: 'location',         source: 'urn:epc:id:sgln:us.dea.RA0000001.0.0' },
            { type: 'owning_party',     source: 'urn:epc:id:pgln:us.dea.RA0000001' },
        ],
        destinationList: [
            { type: 'location',         destination: 'urn:epc:id:sgln:us.dea.BU0000001.0.0' },
            { type: 'owning_party',     destination: 'urn:epc:id:pgln:us.dea.BU0000001' },
        ],
        ...overrides,
    };
}

module.exports = { makeCtx, makeEvent };
