'use strict';

/**
 * submitEvent.js — Caliper Workload Module
 * =========================================
 * Reads EPCIS 2.0 events from events.json and submits them to the
 * logistic-diversion chaincode one at a time.
 *
 * Arguments (set in config.yaml):
 *   contractId  — chaincode ID (e.g. "logistic-diversion")
 *   channelName — Fabric channel (e.g. "mychannel")
 *   eventType   — filter by type: "ObjectEvent" | "AggregationEvent" | "TransactionEvent"
 *   eventsFile  — path to events.json (relative to benchmark/ directory)
 *   maxRetries  — (optional, default 3) resubmit attempts on MVCC_READ_CONFLICT /
 *                 PHANTOM_READ_CONFLICT / endorsement-mismatch failures. This is
 *                 the standard Fabric-recommended client-side mitigation for
 *                 legitimate optimistic-concurrency contention on the same
 *                 business entity (same EPC / lote / local), NOT a workaround
 *                 for a chaincode bug — Fabric applications in production are
 *                 expected to retry on these conflict codes.
 *   retryDelayMs — (optional, default 50) base backoff delay between retries;
 *                  actual delay grows linearly with attempt number (jittered).
 *
 * The workload shuffles the filtered events and cycles through them if
 * txNumber exceeds the available event count.
 *
 * Per-round score capture
 * ------------------------
 * The chaincode's submitEvent returns { accepted, riskScore, eventID, epc, ... }.
 * Caliper itself only records TPS/success-fail, so this module additionally
 * appends one JSON line per transaction to
 *   benchmark/output/round_scores/r{roundIndex}_{eventType}_w{workerIndex}.jsonl
 * containing {roundIndex, eventType, eventID, epc, riskScore, txSuccess, ts}.
 * txSuccess is the Caliper-level commit outcome (per-drug SLA cutoff
 * analysis); riskScore is the chaincode's own business score (per-drug
 * score-evolution analysis). This is a streaming append (fs.createWriteStream
 * in append mode), not an in-memory buffer, so it adds negligible memory
 * overhead regardless of run size — safe for node003's 16GB ceiling.
 * `analysis/merge_round_scores.py` later joins these files with
 * scenario_template.csv (same run, via run_manifest.json) to build the
 * round x drug x event-type x score/SLA table.
 * If the SDK doesn't expose the chaincode result for a given connector
 * version, riskScore is recorded as null — this never affects or blocks the
 * underlying benchmark transaction itself (best-effort, wrapped in try/catch).
 */

'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs   = require('fs');
const path = require('path');

const ROUND_SCORES_DIR = path.resolve(__dirname, '..', 'output', 'round_scores');

/**
 * Best-effort extraction of the chaincode's JSON return value from a Caliper
 * TxStatus object. Different caliper-fabric connector versions expose this
 * differently (GetResult() / result / status.result), so all are tried.
 * Returns null (never throws) if the payload can't be read/parsed.
 */
function extractChaincodeResult(txStatus) {
    try {
        let raw;
        if (typeof txStatus.GetResult === 'function') {
            raw = txStatus.GetResult();
        } else if (txStatus.result !== undefined) {
            raw = txStatus.result;
        }
        if (raw === undefined || raw === null) return null;
        const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        if (!str) return null;
        return JSON.parse(str);
    } catch (_err) {
        return null;
    }
}

// Error signatures that indicate legitimate optimistic-concurrency contention
// on the same business entity (same EPC / lote / local), safely retryable.
const RETRYABLE_PATTERNS = [
    'MVCC_READ_CONFLICT',
    'PHANTOM_READ_CONFLICT',
    'ENDORSEMENT_POLICY_FAILURE',
    'Proposal response mismatch',
    'status code: 11',   // Fabric gRPC ABORTED — actual wording used by the
                         // fabric-gateway Node SDK when a commit is rejected
                         // by validation (covers MVCC/PHANTOM read conflicts).
    'Aborted',
];

function isRetryableError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    return RETRYABLE_PATTERNS.some(pattern => msg.includes(pattern));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class SubmitEventWorkload extends WorkloadModuleBase {

    constructor() {
        super();
        this.events  = [];
        this.index   = 0;
        this.retryCount = 0;
        this.scoreStream = null;
    }

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

        const eventsPath = path.resolve(__dirname, '..', roundArguments.eventsFile);
        const raw        = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
        const allEvents  = raw.epcisBody?.eventList || raw;

        // Filter by event type for this round
        const eventType  = roundArguments.eventType || 'ObjectEvent';
        this.events      = allEvents.filter(e => e.type === eventType);
        this.eventType   = eventType;
        this.roundIndex  = roundIndex;
        this.workerIndex = workerIndex;

        if (this.events.length === 0) {
            throw new Error(`No events of type '${eventType}' found in ${eventsPath}`);
        }

        // Shuffle for realistic submission order
        this.events.sort(() => Math.random() - 0.5);

        // Each worker gets its own slice to avoid duplicate submissions
        const sliceSize  = Math.ceil(this.events.length / totalWorkers);
        const start      = workerIndex * sliceSize;
        this.events      = this.events.slice(start, start + sliceSize);
        this.index       = 0;

        // One append-only file per (round, eventType, worker) — streamed, not
        // buffered in memory. See module docstring for the "per-round score
        // capture" rationale.
        fs.mkdirSync(ROUND_SCORES_DIR, { recursive: true });
        const scoreFilePath = path.join(
            ROUND_SCORES_DIR,
            `r${roundIndex}_${eventType}_w${workerIndex}.jsonl`
        );
        this.scoreStream = fs.createWriteStream(scoreFilePath, { flags: 'a' });

        console.log(`Worker ${workerIndex}: ${this.events.length} ${eventType} events loaded`);
    }

    async submitTransaction() {
        const event = this.events[this.index % this.events.length];
        this.index++;

        const request = {
            contractId:   this.roundArguments.contractId,
            contractFunction: 'submitEvent',
            contractArguments: [JSON.stringify(event)],
            channelName:  this.roundArguments.channelName,
            readOnly:     false,
        };

        const maxRetries   = this.roundArguments.maxRetries   ?? 3;
        const retryDelayMs = this.roundArguments.retryDelayMs ?? 50;

        let attempt = 0;
        while (true) {
            try {
                const results = await this.sutAdapter.sendRequests(request);
                this._recordScore(event, results, true);
                return;
            } catch (err) {
                const canRetry = attempt < maxRetries && isRetryableError(err);
                if (!canRetry) {
                    this._recordScore(event, null, false);
                    throw err;
                }
                attempt++;
                this.retryCount++;
                // Linear backoff + jitter, spreads out resubmissions so they
                // don't immediately re-collide on the same entity again.
                const jitter = Math.random() * retryDelayMs;
                await sleep(retryDelayMs * attempt + jitter);
            }
        }
    }

    /**
     * Best-effort append of {roundIndex, eventType, eventID, epc, riskScore,
     * txSuccess} to this worker's JSONL file. Never throws — a failure here
     * must not fail the underlying benchmark transaction (see docstring).
     * txSuccess is the Caliper-level commit outcome (used for the per-drug
     * SLA cutoff analysis); riskScore is the chaincode's own business score
     * (used for the per-drug score-evolution analysis) — two different axes
     * requested separately, both captured in the same line.
     */
    _recordScore(event, results, txSuccess) {
        if (!this.scoreStream) return;
        try {
            const txStatus = Array.isArray(results) ? results[0] : results;
            const chaincodeResult = txStatus ? extractChaincodeResult(txStatus) : null;
            const line = JSON.stringify({
                roundIndex: this.roundIndex,
                eventType:  this.eventType,
                eventID:    event.eventID || null,
                epc:        Array.isArray(event.epcList) ? (event.epcList[0] || null) : null,
                riskScore:  chaincodeResult ? (chaincodeResult.riskScore ?? null) : null,
                txSuccess,
                ts:         Date.now(),
            });
            this.scoreStream.write(line + '\n');
        } catch (_err) {
            // best-effort only — see docstring
        }
    }

    async cleanupWorkloadModule() {
        if (this.retryCount > 0) {
            console.log(`Worker: ${this.retryCount} transaction(s) retried after MVCC/PHANTOM/endorsement conflicts`);
        }
        if (this.scoreStream) {
            await new Promise(resolve => this.scoreStream.end(resolve));
            this.scoreStream = null;
        }
        this.events = [];
        this.index  = 0;
        this.retryCount = 0;
    }
}

function createWorkloadModule() {
    return new SubmitEventWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
