'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEvents } = require('./read_events');

const events = Array.from({ length: 50 }, (_, i) => ({
  type: 'ObjectEvent', eventID: `e${i}`, note: 'brace } and bracket ] and quote \\" inside', nested: { list: [{ a: i }, [1, 2]] }, unicode: 'ção ✓',
}));
const document = { '@context': ['x'], type: 'EPCISDocument', epcisBody: { eventList: events } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read_events-'));
for (const [name, text] of [['compact', JSON.stringify(document)], ['pretty', JSON.stringify(document, null, 2)]]) {
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, text);
  for (const size of ['7', '64', '1000000']) {
    process.env.READ_EVENTS_CHUNK = size;
    assert.deepStrictEqual(readEvents(file), events, `${name} chunk=${size}`);
  }
}
fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ epcisBody: { eventList: [] } }));
assert.deepStrictEqual(readEvents(path.join(dir, 'empty.json')), []);
fs.rmSync(dir, { recursive: true });
console.log('read_events ok');
