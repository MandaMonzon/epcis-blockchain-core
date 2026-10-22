'use strict';
// Equivalence of the Fabric network and the local evaluator on the same event subset.
//   node network_equivalence.js prepare <dataset dir> <subset.json> [--per-type 5]
//   node network_equivalence.js local   <subset.json> <local.json>
//   node network_equivalence.js submit  <subset.json> <network.json>
//   node network_equivalence.js compare <local.json> <network.json>
// `local` runs the real contract (submitEvent) on an in-memory ledger shared by all events, in file order,
// which is what the network does. `submit` needs a freshly deployed chaincode (empty ledger) and the
// environment of fabric-samples/test-network: FABRIC_NET, and optionally CHAINCODE_NAME and CHANNEL_NAME.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const chaincodeDir = path.join(__dirname, '..', 'epcis-fraud-logistic-diversion');
const [mode, first, second] = process.argv.slice(2);
const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const transactionOf = e => String((e.ilmd && e.ilmd['cbvmda:transactionID']) || '').trim();

function summarise(eventID, outcome) {
  const violations = (outcome.violations || []).map(v => `${v.code}:${v.score}`).sort();
  return { eventID, accepted: outcome.accepted !== false, riskScore: outcome.riskScore || 0, violations };
}

function parseRejection(message) {
  const start = message.indexOf('{"rejected"');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < message.length; i++) {
    if (message[i] === '{') depth++;
    if (message[i] === '}' && --depth === 0) return JSON.parse(message.slice(start, i + 1));
  }
  return null;
}

function prepare(datasetDir, out) {
  const perType = Number(option('--per-type', 5));
  const lines = fs.readFileSync(path.join(datasetDir, 'scenario_template.csv'), 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const iId = header.indexOf('transaction_id');
  const iType = header.indexOf('anomaly_type');
  const chosen = new Map();
  const taken = {};
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const type = cells[iType].trim();
    if ((taken[type] = (taken[type] || 0)) < perType) {
      chosen.set(cells[iId].trim(), type);
      taken[type]++;
    }
  }
  const events = read(path.join(datasetDir, 'events.json')).epcisBody.eventList
    .map((event, arrival) => ({ event, arrival }))
    .filter(({ event }) => chosen.has(transactionOf(event)))
    .sort((a, b) => new Date(a.event.eventTime) - new Date(b.event.eventTime) || a.arrival - b.arrival)
    .map(({ event }) => event);
  fs.writeFileSync(out, JSON.stringify({ labels: Object.fromEntries(chosen), events }));
  console.log(`subset: ${chosen.size} transactions, ${events.length} events`);
}

function loadContract() {
  try {
    require.resolve('fabric-contract-api', { paths: [chaincodeDir, path.join(chaincodeDir, 'chaincode')] });
  } catch (error) {
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      return request === 'fabric-contract-api' ? { Contract: class {}, Context: class {} } : load.call(this, request, ...rest);
    };
    console.log('fabric-contract-api not installed: using an empty base class (submitEvent logic is unchanged)');
  }
  return require(path.join(chaincodeDir, 'chaincode/lib/LogisticDiversionContract'));
}

async function local(subsetFile, out) {
  const Contract = loadContract();
  const { makeCtx } = require(path.join(chaincodeDir, 'test/helpers'));
  const { events, labels } = read(subsetFile);
  const run = async (list, ctx) => {
    const contract = new Contract();
    const results = [];
    for (const event of list) {
      try {
        results.push(summarise(event.eventID, JSON.parse(await contract.submitEvent(ctx, JSON.stringify(event)))));
      } catch (error) {
        results.push(summarise(event.eventID, parseRejection(error.message) || { accepted: false }));
      }
    }
    return results;
  };
  const shared = await run(events, makeCtx());
  const isolated = [];
  const byTransaction = new Map();
  events.forEach(e => (byTransaction.get(transactionOf(e)) || byTransaction.set(transactionOf(e), []).get(transactionOf(e))).push(e));
  for (const list of byTransaction.values()) isolated.push(...await run(list, makeCtx()));
  fs.writeFileSync(out, JSON.stringify({ labels, shared, isolated }));
  console.log(`local: ${shared.length} events scored`);
}

function submit(subsetFile, out) {
  const net = process.env.FABRIC_NET;
  if (!net) throw new Error('FABRIC_NET (path to fabric-samples/test-network) is required');
  const org = path.join(net, 'organizations');
  const env = {
    ...process.env,
    PATH: `${path.join(net, '..', 'bin')}:${process.env.PATH}`,
    FABRIC_CFG_PATH: path.join(net, '..', 'config'),
    CORE_PEER_TLS_ENABLED: 'true',
    CORE_PEER_LOCALMSPID: 'Org1MSP',
    CORE_PEER_ADDRESS: 'localhost:7051',
    CORE_PEER_TLS_ROOTCERT_FILE: path.join(org, 'peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt'),
    CORE_PEER_MSPCONFIGPATH: path.join(org, 'peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp'),
  };
  const args = [
    'chaincode', 'invoke', '-o', 'localhost:7050', '--ordererTLSHostnameOverride', 'orderer.example.com', '--tls',
    '--cafile', path.join(org, 'ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem'),
    '-C', process.env.CHANNEL_NAME || 'mychannel', '-n', process.env.CHAINCODE_NAME || 'logistic-diversion',
    '--peerAddresses', 'localhost:7051', '--tlsRootCertFiles', env.CORE_PEER_TLS_ROOTCERT_FILE, '--waitForEvent',
  ];
  const { events } = read(subsetFile);
  const results = [];
  for (const event of events) {
    let text;
    try {
      text = execFileSync('peer', [...args, '-c', JSON.stringify({ function: 'submitEvent', Args: [JSON.stringify(event)] })],
        { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      text = `${error.stdout || ''}${error.stderr || ''}`;
    }
    const marker = 'payload:';
    const at = text.indexOf(marker);
    let outcome = null;
    if (at >= 0) {
      const quoted = text.slice(at + marker.length).trim().split(/\r?\n/)[0];
      outcome = JSON.parse(JSON.parse(quoted.startsWith('"') ? quoted : `"${quoted}"`));
    } else {
      outcome = parseRejection(text.replace(/\\"/g, '"'));
    }
    if (!outcome) throw new Error(`unparseable response for ${event.eventID}: ${text.slice(0, 300)}`);
    results.push(summarise(event.eventID, outcome));
  }
  fs.writeFileSync(out, JSON.stringify({ network: results }));
  console.log(`network: ${results.length} events submitted`);
}

function compare(localFile, networkFile) {
  const { shared, isolated, labels } = read(localFile);
  const network = read(networkFile).network;
  const byId = new Map(network.map(r => [r.eventID, r]));
  const differences = shared.filter(s => {
    const n = byId.get(s.eventID);
    return !n || n.accepted !== s.accepted || n.riskScore !== s.riskScore || n.violations.join() !== s.violations.join();
  });
  const sharedById = new Map(shared.map(r => [r.eventID, r]));
  const stateEffects = isolated.filter(r => {
    const s = sharedById.get(r.eventID);
    return s.riskScore !== r.riskScore || s.violations.join() !== r.violations.join();
  });
  console.log(`events compared: ${shared.length} (${Object.keys(labels).length} transactions)`);
  console.log(`network vs local (same shared ledger, same order): ${differences.length} different events`);
  differences.slice(0, 5).forEach(d => console.log(`  ${d.eventID}: local=${JSON.stringify(d)} network=${JSON.stringify(byId.get(d.eventID))}`));
  console.log(`local shared ledger vs isolated transactions: ${stateEffects.length} events differ (cross-transaction state)`);
  fs.writeFileSync(`${networkFile}.comparison.json`, JSON.stringify({
    events: shared.length, transactions: Object.keys(labels).length,
    networkVsLocalDifferences: differences.length, sharedVsIsolatedDifferences: stateEffects.length,
  }));
  process.exitCode = differences.length ? 1 : 0;
}

(async () => {
  if (mode === 'prepare') prepare(first, second);
  else if (mode === 'local') await local(first, second);
  else if (mode === 'submit') submit(first, second);
  else if (mode === 'compare') compare(first, second);
  else throw new Error('mode must be prepare, local, submit or compare');
})().catch(error => { console.error(error.message); process.exit(2); });
