'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs   = require('fs');
const path = require('path');

class SubmitEventWorkload extends WorkloadModuleBase {
    constructor() {
        super();
        this.events = [];
        this.txIndex = 0;
    }

    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);

        this.contractId  = roundArguments.contractId;
        this.channelName = roundArguments.channelName;
        this.eventType   = roundArguments.eventType;

        const eventsFilePath = path.resolve(__dirname, roundArguments.eventsFile);

        // Load all matching events once, then slice per worker so each worker
        // operates on a disjoint subset — prevents MVCC_READ_CONFLICT (status 11)
        // that occurs when concurrent workers submit events with the same EPC keys.
        const allEvents = await this._streamParseEvents(eventsFilePath, this.eventType, 0, Infinity);

        if (allEvents.length === 0) {
            throw new Error(`No ${this.eventType} events found in ${eventsFilePath}`);
        }

        const perWorker = Math.ceil(allEvents.length / totalWorkers);
        const start     = workerIndex * perWorker;
        this.events     = allEvents.slice(start, start + perWorker);

        // Final safety: if slice is empty (more workers than events), wrap around
        if (this.events.length === 0) {
            this.events = allEvents.slice(workerIndex % allEvents.length, (workerIndex % allEvents.length) + 1);
        }

        console.log(`Worker ${workerIndex}/${totalWorkers}: ${this.events.length} ${this.eventType} events (slice ${start}–${start + this.events.length - 1} of ${allEvents.length})`);
    }

    _streamParseEvents(filePath, eventType, skip = 0, limit = 500) {
        return new Promise((resolve, reject) => {
            const events = [];
            let skipped = 0;
            let done = false;
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            let buffer = '';
            let depth = 0;
            let inEventList = false;
            let capturing = false;
            let objBuffer = '';

            const finish = () => {
                if (!done) { done = true; stream.destroy(); resolve(events); }
            };

            stream.on('data', chunk => {
                if (done) return;
                buffer += chunk;
                for (let i = 0; i < buffer.length; i++) {
                    if (done) break;
                    const ch = buffer[i];
                    if (!inEventList) {
                        if (buffer.slice(Math.max(0, i - 11), i + 1).includes('"eventList"')) {
                            inEventList = true;
                        }
                        continue;
                    }
                    if (!capturing) {
                        if (ch === '{') { capturing = true; depth = 1; objBuffer = '{'; }
                        continue;
                    }
                    objBuffer += ch;
                    if (ch === '{') depth++;
                    else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                            capturing = false;
                            try {
                                const obj = JSON.parse(objBuffer);
                                if (!eventType || obj.type === eventType) {
                                    if (skipped < skip) {
                                        skipped++;
                                    } else {
                                        events.push(obj);
                                        if (events.length >= limit) { finish(); break; }
                                    }
                                }
                            } catch(e) { /* skip malformed */ }
                            objBuffer = '';
                        }
                    }
                }
                buffer = '';
            });
            stream.on('end', finish);
            stream.on('error', reject);
            stream.on('close', () => { if (!done) finish(); });
        });
    }

    async submitTransaction() {
        const event = this.events[this.txIndex % this.events.length];
        this.txIndex++;

        const txEvent = Object.assign({}, event, {
            eventID: `${event.eventID || 'evt'}_w${this.workerIndex}_${this.txIndex}`
        });

        const request = {
            contractId:        this.contractId,
            contractFunction:  'submitEvent',
            invokerIdentity:   'User1',
            contractArguments: [JSON.stringify(txEvent)],
            readOnly:          false,
        };

        await this.sutAdapter.sendRequests(request);
    }
}

module.exports.createWorkloadModule = () => new SubmitEventWorkload();

