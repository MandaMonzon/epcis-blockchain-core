'use strict';

/**
 * TaxonomyRule.js
 * ===============
 * Base class for all chaincode rules (Class A and Class B).
 *
 * Each rule implements evaluate(ctx, event) and returns a RuleResult.
 *
 * RuleResult.pass()          → event is accepted (no violation)
 * RuleResult.fail(code, msg, score) → violation found
 *   - Class A rules: score is ignored, event is blocked
 *   - Class B rules: score contributes to the cumulative risk score
 */

class RuleResult {
    constructor(passed, errorCode = null, message = null, score = 0) {
        this.passed    = passed;
        this.errorCode = errorCode;
        this.message   = message;
        this.score     = score; // risk contribution (0–100), only used in Class B
    }

    static pass() {
        return new RuleResult(true);
    }

    static fail(errorCode, message, score = 0, meta = {}) {
        const r  = new RuleResult(false, errorCode, message, score);
        r.meta   = meta; // extra fields (e.g. supplierCount) for audit output
        return r;
    }
}

class TaxonomyRule {
    constructor(name, description) {
        this.name        = name;
        this.description = description;
    }

    // Subclasses must implement this
    async evaluate(ctx, event) {
        throw new Error(`${this.name}.evaluate() not implemented`);
    }
}

module.exports = { TaxonomyRule, RuleResult };
