
'use strict';
 
/**

* HistoryStore

* ============

* Append-only ledger access for per-entity records, keyed by Fabric composite

* keys. Every write targets a brand-new key (never re-reads then overwrites

* an existing one), so concurrent transactions for the same entity never

* collide on MVCC read-write conflicts.

*/

class HistoryStore {

    static async append(ctx, objectType, keyParts, record) {

        const key = ctx.stub.createCompositeKey(objectType, keyParts);

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(record)));

    }
 
    static async queryAll(ctx, objectType, keyParts) {

        const iterator = await ctx.stub.getStateByPartialCompositeKey(objectType, keyParts);

        const records = [];

        let entry = await iterator.next();

        while (!entry.done) {

            records.push(JSON.parse(entry.value.value.toString('utf8')));

            entry = await iterator.next();

        }

        await iterator.close();

        return records;

    }
 
    static async queryLatest(ctx, objectType, keyParts, timeField) {

        const records = await HistoryStore.queryAll(ctx, objectType, keyParts);

        if (records.length === 0) return null;

        return records.reduce(

            (latest, record) => (!latest || new Date(record[timeField]) > new Date(latest[timeField]) ? record : latest),

            null

        );

    }

}
 
module.exports = HistoryStore;

