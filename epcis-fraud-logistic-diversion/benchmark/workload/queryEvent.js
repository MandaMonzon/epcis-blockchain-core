'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');
const path = require('path');

const OUTPUT_ROOT = path.resolve(__dirname, '..', 'output');

// Read-only rounds over events committed by the submit rounds of the same run.
// Arguments: contractId, channelName, runId, label, queryFunction (getEvent | getProductState | getAuditSummary).
class QueryEventWorkload extends WorkloadModuleBase {
    constructor() {
        super();
        this.targets = [];
        this.index = 0;
        this.stream = null;
    }

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        const runDir = path.join(OUTPUT_ROOT, roundArguments.runId || '');
        this.fn = roundArguments.queryFunction;
        if (this.fn !== 'getAuditSummary') {
            const lines = fs.readFileSync(path.join(runDir, 'committed.jsonl'), 'utf8').split('\n').filter(Boolean);
            const committed = lines.map(l => JSON.parse(l));
            this.targets = this.fn === 'getEvent'
                ? committed.map(c => c.eventID)
                : [...new Set(committed.filter(c => c.type === 'ObjectEvent' && c.epc).map(c => c.epc))];
            if (this.targets.length === 0) throw new Error(`No committed targets for ${this.fn} in ${runDir}`);
        }
        const dir = path.join(runDir, 'round_scores');
        fs.mkdirSync(dir, { recursive: true });
        this.stream = fs.createWriteStream(path.join(dir, `r${roundIndex}_${roundArguments.label}_w${workerIndex}.jsonl`), { flags: 'a' });
    }

    async submitTransaction() {
        const argument = this.fn === 'getAuditSummary' ? [] : [this.targets[this.index++ % this.targets.length]];
        const startedAt = Date.now();
        try {
            await this.sutAdapter.sendRequests({
                contractId: this.roundArguments.contractId,
                contractFunction: this.fn,
                contractArguments: argument,
                channelName: this.roundArguments.channelName,
                readOnly: true,
            });
            this.stream.write(JSON.stringify({ outcome: 'committed', latencyMs: Date.now() - startedAt, ts: Date.now() }) + '\n');
        } catch (err) {
            this.stream.write(JSON.stringify({ outcome: 'error', latencyMs: Date.now() - startedAt, ts: Date.now() }) + '\n');
            throw err;
        }
    }

    async cleanupWorkloadModule() {
        if (this.stream) await new Promise(resolve => this.stream.end(resolve));
        this.stream = null;
        this.targets = [];
    }
}

module.exports.createWorkloadModule = () => new QueryEventWorkload();
