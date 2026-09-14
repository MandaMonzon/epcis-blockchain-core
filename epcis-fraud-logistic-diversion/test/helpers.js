
'use strict';
 
/**

* Minimal mock of Hyperledger Fabric's ctx.stub for unit tests.

* Stores state in memory — no real blockchain needed.

*/

const COMPOSITE_KEY_DELIMITER = '\u0000';
 
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
 
    createCompositeKey(objectType, attributes) {

        return COMPOSITE_KEY_DELIMITER + [objectType, ...attributes].join(COMPOSITE_KEY_DELIMITER) + COMPOSITE_KEY_DELIMITER;

    }
 
    async getStateByPartialCompositeKey(objectType, attributes) {

        const prefix = COMPOSITE_KEY_DELIMITER + [objectType, ...attributes].join(COMPOSITE_KEY_DELIMITER) + COMPOSITE_KEY_DELIMITER;

        const matches = [];

        for (const [key, value] of this._state.entries()) {

            if (key.startsWith(prefix)) matches.push({ key, value: Buffer.from(value) });

        }

        let index = 0;

        return {

            async next() {

                if (index >= matches.length) return { done: true };

                return { done: false, value: matches[index++] };

            },

            async close() {},

        };

    }
 
    reset() { this._state.clear(); }

}
 
function makeCtx() {

    const stub = new MockStub();

    return { stub };

}
 
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

