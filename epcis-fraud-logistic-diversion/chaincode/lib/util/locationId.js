'use strict';

// EPCIS 2.0 documents carry bizLocation as {id}, while the contract flattens it to a string before the rules run.
function locationId(event) {
    const location = event.bizLocation;
    return (location && typeof location === 'object' ? location.id : location) || '';
}

module.exports = { locationId };
