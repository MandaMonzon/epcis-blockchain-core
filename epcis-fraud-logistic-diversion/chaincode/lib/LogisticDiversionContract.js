
'use strict';
 
/**

* LogisticDiversionContract.js

* =============================

* Main Hyperledger Fabric smart contract for logistics diversion detection.

*

* Ledger key structure (see EpcisConstants.js):

*   event_{eventID}                    → full event JSON

*   audit_result_{eventID}             → audit record

*   productState(epc, eventID)         → one immutable record per event per SGTIN

*   supplyComplexity(loc, supplierId)  → one immutable marker per distinct supplier

*   fragmentation(loc, srcId, eventID) → one immutable timestamp per receiving event

*

* The last three use Fabric composite keys instead of a single shared key per

* entity — each write targets a brand-new key, so concurrent transactions for

* the same product/location never race on a read-modify-write cycle (which

* was the cause of MVCC_READ_CONFLICT under load).

*/
 
const { Contract } = require('fabric-contract-api');

const RuleEngine           = require('./RuleEngine');

const HistoryStore         = require('./util/HistoryStore');

const { STATE_KEY_PREFIX } = require('../constants/EpcisConstants');
 
class LogisticDiversionContract extends Contract {

    constructor() {

        super('LogisticDiversionContract');

    }
 
    async submitEvent(ctx, eventJsonStr) {

        let event;

        try {

            event = JSON.parse(eventJsonStr);

        } catch (e) {

            throw new Error(`INVALID_JSON: ${e.message}`);

        }
 
        if (event.bizLocation && typeof event.bizLocation === 'object') {

            event.bizLocation = event.bizLocation.id || '';

        }

        if (event.readPoint && typeof event.readPoint === 'object') {

            event.readPoint = event.readPoint.id || '';

        }
 
        const result = await RuleEngine.evaluate(ctx, event);
 
        if (!result.accepted) {

            throw new Error(JSON.stringify({ rejected: true, ...result }));

        }
 
        await ctx.stub.putState(

            STATE_KEY_PREFIX.EVENT + event.eventID,

            Buffer.from(JSON.stringify(event))

        );
 
        const auditRecord = {

            accepted:   result.accepted,

            eventID:    result.eventID,

            epc:        result.epc,

            bizStep:    result.bizStep,

            riskScore:  result.riskScore,

            violations: result.violations,

        };

        await ctx.stub.putState(

            STATE_KEY_PREFIX.AUDIT + event.eventID,

            Buffer.from(JSON.stringify(auditRecord))

        );
 
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

        const summary = {

            totalEvents:    0,

            rejectedEvents: 0,

            acceptedEvents: 0,

            riskBands: { clean: 0, elevated: 0, high: 0, critical: 0, maxRisk: 0 },

            violationsByRule: {},

        };
 
        const iterator = await ctx.stub.getStateByRange(

            STATE_KEY_PREFIX.AUDIT, STATE_KEY_PREFIX.AUDIT + '\xFF'

        );
 
        for await (const { value } of iterator) {

            const record = JSON.parse(value.toString());

            summary.totalEvents++;
 
            if (!record.accepted) {

                summary.rejectedEvents++;

                continue;

            }
 
            summary.acceptedEvents++;

            const s = record.riskScore || 0;
 
            if      (s === 0)        summary.riskBands.clean++;

            else if (s < 30)         summary.riskBands.elevated++;

            else if (s < 60)         summary.riskBands.high++;

            else if (s < 85)         summary.riskBands.critical++;

            else                     summary.riskBands.maxRisk++;
 
            for (const v of (record.violations || [])) {

                summary.violationsByRule[v.rule] = (summary.violationsByRule[v.rule] || 0) + 1;

            }

        }
 
        return JSON.stringify(summary);

    }

}
 
module.exports = LogisticDiversionContract;

