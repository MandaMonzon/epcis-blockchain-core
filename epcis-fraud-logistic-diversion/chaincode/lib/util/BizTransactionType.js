'use strict';

/**
 * Normalises a bizTransaction type to its CBV short name.
 * EPCIS 2.0 JSON uses short names ("desadv"); older datasets used the
 * urn:epcglobal:cbv:btt: URN and GS1 Digital Link style uses https://ns.gs1.org/cbv/BTT-x.
 */
const PREFIXES = ['urn:epcglobal:cbv:btt:', 'https://ns.gs1.org/cbv/BTT-'];

function bizTransactionKind(type) {
    const value = String(type || '').trim();
    const prefix = PREFIXES.find(p => value.startsWith(p));
    return prefix ? value.slice(prefix.length) : value;
}

module.exports = { bizTransactionKind };
