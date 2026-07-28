'use strict';

const { expect } = require('chai');
const RuleEngine = require('../chaincode/lib/RuleEngine');
const LogisticsDiversionRule = require('../chaincode/lib/rules/LogisticsDiversionRule');
const S = require('../chaincode/constants/RiskScoreConfig');
const { makeCtx, makeEvent } = require('./helpers');

describe('LogisticsDiversionRule — Class B', () => {
    let ctx;

    beforeEach(() => { ctx = makeCtx(); });

    // ── Blocked disposition ───────────────────────────────────────────────

    it('rejects a recalled product still being shipped', async () => {
        const event = makeEvent({ bizStep: 'shipping', disposition: 'recalled' });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.accepted).to.be.true; // Class B — does not block
        expect(result.violations[0].code).to.equal('LOGISTICS_DIVERSION_BLOCKED_DISPOSITION');
        expect(result.riskScore).to.equal(S.BLOCKED_DISPOSITION);
    });

    it('rejects a product recorded as recalled trying to move to receiving', async () => {
        const epc = 'urn:epc:id:sgtin:0614141.107346.BLOCKED001';
        // Set up product state with a blocked disposition
        const { STATE_KEY_PREFIX } = require('../chaincode/constants/EpcisConstants');
        await ctx.stub.putState(
            STATE_KEY_PREFIX.PRODUCT + epc,
            Buffer.from(JSON.stringify({ lastBizStep: 'shipping', lastEventTime: '2024-01-01T08:00:00Z', disposition: 'recalled' }))
        );
        const event  = makeEvent({ bizStep: 'receiving', epcList: [epc], disposition: 'active' });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.violations[0].code).to.equal('LOGISTICS_DIVERSION_BLOCKED_STATUS');
    });

    // ── Sequence validation ───────────────────────────────────────────────

    it('rejects shipping → dispensing (not an authorized transition)', async () => {
        const epc = 'urn:epc:id:sgtin:0614141.107346.SEQ001';
        const { STATE_KEY_PREFIX } = require('../chaincode/constants/EpcisConstants');
        await ctx.stub.putState(
            STATE_KEY_PREFIX.PRODUCT + epc,
            Buffer.from(JSON.stringify({ lastBizStep: 'shipping', lastEventTime: '2024-01-01T08:00:00Z' }))
        );
        const event  = makeEvent({ bizStep: 'dispensing', epcList: [epc] });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.violations[0].code).to.equal('LOGISTICS_DIVERSION_SEQUENCE');
        expect(result.riskScore).to.equal(S.INVALID_SEQUENCE);
    });

    it('accepts commissioning → packing (valid transition)', async () => {
        const event  = makeEvent({ bizStep: 'commissioning' });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.accepted).to.be.true;
        expect(result.violations).to.be.empty;

        await LogisticsDiversionRule.updateProductState(ctx, event);

        const next = makeEvent({
            eventID:   'urn:uuid:test-event-002',
            bizStep:   'packing',
            eventTime: '2024-01-01T11:00:00Z',
        });
        const result2 = await RuleEngine.evaluate(ctx, next);
        expect(result2.violations).to.be.empty;
    });

    // ── Timing validation ─────────────────────────────────────────────────

    it('flags an out-of-order event (earlier timestamp)', async () => {
        const epc = 'urn:epc:id:sgtin:0614141.107346.TIME001';
        const { STATE_KEY_PREFIX } = require('../chaincode/constants/EpcisConstants');
        await ctx.stub.putState(
            STATE_KEY_PREFIX.PRODUCT + epc,
            Buffer.from(JSON.stringify({ lastBizStep: 'shipping', lastEventTime: '2024-06-01T10:00:00Z' }))
        );
        const event  = makeEvent({ bizStep: 'receiving', epcList: [epc], eventTime: '2024-01-01T08:00:00Z' });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.violations[0].code).to.equal('LOGISTICS_DIVERSION_TIMING');
    });

    // ── Cross-jurisdiction ────────────────────────────────────────────────

    it('rejects EU → US move at dispensing step', async () => {
        const event = makeEvent({
            bizStep:        'dispensing',
            sourceList:     [{ type: 'owning_party', source: 'urn:epc:id:pgln:eu.gln.DE0000001' }],
            destinationList:[{ type: 'owning_party', destination: 'urn:epc:id:pgln:us.dea.BU0000001' }],
        });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.violations[0].code).to.equal('LOGISTICS_DIVERSION_JURISDICTION');
        expect(result.riskScore).to.equal(S.CROSS_JURISDICTION);
    });

    it('accepts EU → US move at shipping step', async () => {
        const event = makeEvent({
            bizStep:        'shipping',
            sourceList:     [{ type: 'owning_party', source: 'urn:epc:id:pgln:eu.gln.DE0000001' }],
            destinationList:[{ type: 'owning_party', destination: 'urn:epc:id:pgln:us.dea.BU0000001' }],
        });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.accepted).to.be.true;
        expect(result.violations).to.be.empty;
    });
});

describe('SupplyBaseComplexityRule — Class B', () => {
    let ctx;
    beforeEach(() => { ctx = makeCtx(); });

    it('accepts a buyer with 3 or fewer suppliers (normal)', async () => {
        const event = makeEvent({
            bizStep:     'receiving',
            bizLocation: 'urn:epc:id:sgln:us.dea.PHARM001.0.0',
            sourceList:  [
                { type: 'owning_party', source: 'urn:epc:id:pgln:us.dea.DIST001' },
                { type: 'owning_party', source: 'urn:epc:id:pgln:us.dea.DIST002' },
            ],
        });
        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.violations.filter(v => v.code === 'SUPPLY_BASE_COMPLEXITY')).to.be.empty;
    });

    it.skip('flags a buyer with 9+ suppliers (critical — 99th percentile) — PENDING DISCUSSION WITH FAUSTO', async () => {
        // SupplyBaseComplexityRule is currently disabled in RuleEngine.
        // Skilton et al. (2024) threshold was derived from domestic US ARCOS data.
        // Applicability to EU→US logistics diversion is under review.
        // See TODO in RuleEngine.js — discuss with Fausto before re-enabling.
        const { STATE_KEY_PREFIX } = require('../chaincode/constants/EpcisConstants');
        const location = 'urn:epc:id:sgln:us.dea.PHARM999.0.0';
        const existing = Array.from({ length: 8 }, (_, i) => `urn:epc:id:pgln:us.dea.DIST${i + 1}`);
        await ctx.stub.putState(
            STATE_KEY_PREFIX.COMPLEXITY + location,
            Buffer.from(JSON.stringify({ suppliers: existing }))
        );
        const event = makeEvent({
            bizStep:     'receiving',
            bizLocation: location,
            sourceList:  [{ type: 'owning_party', source: 'urn:epc:id:pgln:us.dea.DIST9' }],
        });
        const result = await RuleEngine.evaluate(ctx, event);
        const hit = result.violations.find(v => v.code === 'SUPPLY_BASE_COMPLEXITY');
        expect(hit).to.exist;
        expect(hit.score).to.equal(S.SUPPLY_CRITICAL);
    });
});

describe('VolumeFragmentationRule — Class B', () => {
    let ctx;
    beforeEach(() => { ctx = makeCtx(); });

    it('flags a buyer receiving 10+ orders from the same source in 30 days', async () => {
        const { VolumeFragmentationRule } = require('../chaincode/lib/rules/VolumeFragmentationRule');
        const location = 'urn:epc:id:sgln:us.dea.PHARM_FRAG.0.0';
        const srcId    = 'urn:epc:id:pgln:us.dea.DIST_FRAG';
        const base     = new Date('2024-06-01T10:00:00Z').getTime();

        // Pre-load 9 timestamps within 30 days
        const key    = 'vol_frag_' + location + '_' + srcId;
        const stamps = Array.from({ length: 9 }, (_, i) => base + i * 3_600_000);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify({ timestamps: stamps })));

        const event = makeEvent({
            bizStep:     'receiving',
            bizLocation: location,
            sourceList:  [{ type: 'owning_party', source: srcId }],
            eventTime:   new Date(base + 10 * 3_600_000).toISOString(),
        });
        const result = await RuleEngine.evaluate(ctx, event);
        const hit = result.violations.find(v => v.code === 'VOLUME_FRAGMENTATION');
        expect(hit).to.exist;
        expect(hit.score).to.equal(S.FRAGMENTATION_ELEVATED);
    });
});

describe('RuleEngine — score clamping', () => {
    it('clamps combined score to 100 maximum', async () => {
        const ctx      = makeCtx();
        const location = 'urn:epc:id:sgln:us.dea.PHARM_CLAMP.0.0';
        const srcId    = 'urn:epc:id:pgln:us.dea.DIST_CLAMP';
        const base     = new Date('2024-06-01T10:00:00Z').getTime();

        // Pre-load 19 fragmentation timestamps → VolumeFragmentationRule adds 1 more → 20 → score 60
        const stamps = Array.from({ length: 19 }, (_, i) => base + i * 3_600_000);
        await ctx.stub.putState(
            'vol_frag_' + location + '_' + srcId,
            Buffer.from(JSON.stringify({ timestamps: stamps }))
        );

        // Event also has recalled disposition → LogisticsDiversionRule fires score 85
        // 85 + 60 = 145 → clamped to 100
        const event = makeEvent({
            bizStep:     'receiving',
            disposition: 'recalled',
            bizLocation: location,
            sourceList:  [{ type: 'owning_party', source: srcId }],
            eventTime:   new Date(base + 20 * 3_600_000).toISOString(),
        });

        const result = await RuleEngine.evaluate(ctx, event);
        expect(result.accepted).to.be.true;
        expect(result.violations.length).to.be.greaterThanOrEqual(2);
        expect(result.riskScore).to.equal(100);
    });
});
