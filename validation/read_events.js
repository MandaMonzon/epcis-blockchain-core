'use strict';
const fs = require('fs');

// Reads epcisBody.eventList one event at a time, so files above Node's 512 MB string limit can be loaded.
// Events are the objects at depth 4 of { epcisBody: { eventList: [ {...} ] } }; the generator writes no other array there.
function scanEvents(file, onEvent) {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(Number(process.env.READ_EVENTS_CHUNK) || (1 << 24));
  let base = 0;
  let pendingStart = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = [];
  try {
    for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0; base += n) {
      let start = depth >= 4 ? 0 : -1;
      for (let i = 0; i < n; i++) {
        const c = chunk[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) inString = false;
          continue;
        }
        if (c === 0x22) inString = true;
        else if (c === 0x7b || c === 0x5b) {
          if (++depth === 4 && c === 0x7b) {
            start = i;
            pendingStart = base + i;
          }
        } else if (c === 0x7d || c === 0x5d) {
          if (depth-- === 4 && start >= 0) {
            pending.push(Buffer.from(chunk.subarray(start, i + 1)));
            onEvent(Buffer.concat(pending), pendingStart);
            pending = [];
            start = -1;
          }
        }
      }
      if (start >= 0 && depth >= 4) pending.push(Buffer.from(chunk.subarray(start, n)));
    }
  } finally {
    fs.closeSync(fd);
  }
}

function readEvents(file) {
  const events = [];
  scanEvents(file, buffer => events.push(JSON.parse(buffer.toString('utf8'))));
  return events;
}

// Keeps only {eventTime, offset, length} per event (a few dozen bytes instead of the whole parsed event).
// `pick(event)` may return extra small fields to keep per event (for example the transaction id).
function indexEvents(file, pick = () => ({})) {
  const index = [];
  scanEvents(file, (buffer, offset) => {
    const event = JSON.parse(buffer.toString('utf8'));
    index.push({ eventTime: event.eventTime, ...pick(event), offset, length: buffer.length });
  });
  return index;
}

function readEventAt(fd, { offset, length }) {
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, offset);
  return JSON.parse(buffer.toString('utf8'));
}

module.exports = { readEvents, indexEvents, readEventAt };
