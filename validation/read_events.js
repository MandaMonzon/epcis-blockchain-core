'use strict';
const fs = require('fs');

// Reads epcisBody.eventList one event at a time, so files above Node's 512 MB string limit can be loaded.
// Events are the objects at depth 4 of { epcisBody: { eventList: [ {...} ] } }; the generator writes no other array there.
function readEvents(file) {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(Number(process.env.READ_EVENTS_CHUNK) || (1 << 24));
  const events = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = [];
  try {
    for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) {
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
          if (++depth === 4 && c === 0x7b) start = i;
        } else if (c === 0x7d || c === 0x5d) {
          if (depth-- === 4 && start >= 0) {
            pending.push(Buffer.from(chunk.subarray(start, i + 1)));
            events.push(JSON.parse(Buffer.concat(pending).toString('utf8')));
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
  return events;
}

module.exports = { readEvents };
