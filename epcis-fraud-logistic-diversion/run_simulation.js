#!/usr/bin/env node
/**
 * run_simulation.js
 * =================
 * Runs all EPCIS events from events.json through the smart contract rule engine
 * without a real Hyperledger Fabric network.
 *
 * Simulates the ledger with an in-memory Map so state-dependent rules
 * (SupplyBaseComplexityRule, VolumeFragmentationRule) work correctly across events.
 *
 * Output: contract_output.json — one result object per event.
 *
 * Usage:
 *   node run_simulation.js [path/to/events.json] [path/to/output.json]
 *
 * Defaults:
 *   input  → ../../epcis-arcos-etl-generator/output/events.json
 *   output → ./output/contract_output.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────
const inputPath  = process.argv[2]
    || path.resolve(__dirname, '../../epcis-arcos-etl-generator/output/events.json');
const outputPath = process.argv[3]
    || path.resolve(__dirname, 'output/contract_output.json');

// ── In-memory ledger stub (simulates ctx.stub) ────────────────────────────────
function makeLedgerStub() {
    const store = new Map();
    return {
        getState:    async (key) => {
            const v = store.get(key);
            return v ? Buffer.from(v) : Buffer.alloc(0);
        },
        putState:    async (key, value) => { store.set(key, value.toString()); },
        deleteState: async (key) => { store.delete(key); },
        getStateByRange: async (start, end) => {
            const results = [];
            for (const [k, v] of store.entries()) {
                if (k >= start && k < end) results.push({ key: k, value: Buffer.from(v) });
            }
            let idx = 0;
            return {
                async next() {
                    if (idx < results.length) return { value: results[idx++], done: false };
                    return { value: undefined, done: true };
                },
                async close() {},
                [Symbol.asyncIterator]() { return this; },
            };
        },
    };
}

// ── Load rule engine ──────────────────────────────────────────────────────────
const RuleEngine = require('./chaincode/lib/RuleEngine');

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Reading events from: ${inputPath}`);
    const raw    = fs.readFileSync(inputPath, 'utf8');
    const doc    = JSON.parse(raw);
    const events = doc.epcisBody?.eventList ?? doc;

    if (!Array.isArray(events)) {
        console.error('events.json must contain an array at epcisBody.eventList or root level.');
        process.exit(1);
    }

    const stub    = makeLedgerStub();
    const ctx     = { stub };
    const results = [];
    let accepted  = 0, rejected = 0, flagged = 0;

    console.log(`Processing ${events.length.toLocaleString()} events...\n`);
    const t0 = Date.now();

    for (let i = 0; i < events.length; i++) {
        const event = { ...events[i] };

        // Normalize GS1 object fields (same as the real contract does)
        if (event.bizLocation && typeof event.bizLocation === 'object')
            event.bizLocation = event.bizLocation.id || '';
        if (event.readPoint && typeof event.readPoint === 'object')
            event.readPoint = event.readPoint.id || '';

        const result = await RuleEngine.evaluate(ctx, event);

        results.push({
            eventIndex:   i,
            eventID:      event.eventID   ?? null,
            epc:          Array.isArray(event.epcList) ? event.epcList[0] : null,
            bizStep:      event.bizStep   ?? null,
            eventTime:    event.eventTime ?? null,
            bizLocation:  event.bizLocation ?? null,
            accepted:     result.accepted,
            riskScore:    result.riskScore ?? 0,
            riskBand:     riskBand(result.riskScore ?? 0),
            violations:   result.violations ?? [],
        });

        if (!result.accepted) rejected++;
        else if ((result.riskScore ?? 0) > 0) flagged++;
        else accepted++;

        if ((i + 1) % 5000 === 0) {
            process.stdout.write(`  ${(i + 1).toLocaleString()} / ${events.length.toLocaleString()} events processed...\r`);
        }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s.`);
    console.log(`  Accepted (score=0):  ${accepted.toLocaleString()}`);
    console.log(`  Flagged  (score>0):  ${flagged.toLocaleString()}`);
    console.log(`  Rejected (Class A):  ${rejected.toLocaleString()}`);

    // Write output
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ summary: { total: events.length, accepted, flagged, rejected, elapsed_sec: parseFloat(elapsed) }, results }, null, 2));
    console.log(`\nOutput written to: ${outputPath}`);
}

function riskBand(score) {
    if (score === 0)   return 'clean';
    if (score <= 30)   return 'low';
    if (score <= 60)   return 'medium';
    if (score <= 85)   return 'high';
    return 'critical';
}

main().catch(e => { console.error(e); process.exit(1); });
