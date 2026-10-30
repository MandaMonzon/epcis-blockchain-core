'use strict';

const assert = require('assert');
const { extractLotId, extractTransactionId } = require('../chaincode/lib/util/LotIdentifier');
const { bizTransactionKind } = require('../chaincode/lib/util/BizTransactionType');
const ShipmentReceiptMismatchRule = require('../chaincode/lib/rules/ShipmentReceiptMismatchRule');
const { makeCtx } = require('./helpers');

describe('EPCIS 2.0 standard form', () => {
    it('reads the lot from ilmd on ADD events', () => {
        const event = { ilmd: { 'cbvmda:lotNumber': ' L1 ', 'cbvmda:transactionID': 'T1' } };
        assert.strictEqual(extractLotId(event), 'L1');
        assert.strictEqual(extractTransactionId(event), 'T1');
    });

    it('reads the lot from arcos extension fields on OBSERVE events', () => {
        const event = { 'arcos:lotNumber': 'L2', 'arcos:transactionID': 'T2' };
        assert.strictEqual(extractLotId(event), 'L2');
        assert.strictEqual(extractTransactionId(event), 'T2');
    });

    it('prefers ilmd over the extension fields', () => {
        const event = { ilmd: { 'cbvmda:transactionID': 'A' }, 'arcos:transactionID': 'B' };
        assert.strictEqual(extractTransactionId(event), 'A');
    });

    it('returns null when no lot identifier exists', () => {
        assert.strictEqual(extractLotId({}), null);
        assert.strictEqual(extractTransactionId({}), null);
    });

    it('accepts short names, the CBV URN and the GS1 URI for bizTransaction types', () => {
        for (const form of ['desadv', 'urn:epcglobal:cbv:btt:desadv', 'https://ns.gs1.org/cbv/BTT-desadv']) {
            assert.strictEqual(bizTransactionKind(form), 'desadv');
        }
        assert.strictEqual(bizTransactionKind(undefined), '');
    });

    it('flags a shipment without receipt using short names and arcos fields', async () => {
        const ctx = makeCtx();
        const despatch = {
            eventID: 'e1', type: 'TransactionEvent', eventTime: '2024-01-02T00:00:00Z', bizStep: 'shipping',
            'arcos:transactionID': 'T9',
            bizTransactionList: [{ type: 'desadv', bizTransaction: 'po-9' }],
            destinationList: [{ type: 'location', destination: 'urn:epc:id:sgln:us.dea.BR1.0.0' }],
        };
        await ShipmentReceiptMismatchRule.updateShipmentState(ctx, despatch);
        const pending = await ShipmentReceiptMismatchRule.auditPendingShipments(ctx, new Date('2024-03-30T00:00:00Z'));
        assert.strictEqual(pending.length, 1);
    });
});
