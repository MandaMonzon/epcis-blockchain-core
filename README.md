# epcis-blockchain-core

Smart contracts for detecting pharmaceutical supply chain fraud using **GS1 EPCIS 2.0** and **Hyperledger Fabric**.

Part of the ARCOS → EPCIS 2.0 research pipeline.

---

## Requirements

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Node.js | 18+ | https://nodejs.org |
| Hyperledger Fabric | 2.5 | `curl -sSL https://bit.ly/2ysbOFE \| bash -s -- 2.5.0 1.5.7` |

The Fabric install script creates a `fabric-samples/` folder next to this repo.

---

## Running the benchmark

```bash
# 1. Start the Fabric test network
cd fabric-samples/test-network
./network.sh up createChannel -c mychannel -ca

# 2. Deploy the chaincode
./network.sh deployCC \
  -ccn logistic-diversion \
  -ccp ../../epcis-blockchain-core/epcis-fraud-logistic-diversion/chaincode \
  -ccl javascript

# 3. Run Caliper
cd ../../epcis-blockchain-core/epcis-fraud-logistic-diversion/benchmark
./run-benchmark.sh
```

`run-benchmark.sh` builds the Caliper Docker image and generates the connection profile from your local Fabric network automatically.

---

## Structure

```
epcis-blockchain-core/
├── epcis-fraud-logistic-diversion/     ← implemented (ARCOS diversion detection)
│   ├── chaincode/                      ← Fabric smart contract (Node.js)
│   ├── test/                           ← unit tests (Jest)
│   └── benchmark/                      ← Caliper workload
├── epcis-fraud-chemical-adulteration/  ← placeholder
├── epcis-fraud-digital-spoof/          ← placeholder
├── epcis-fraud-document-falsification/ ← placeholder
├── epcis-fraud-physical-tampering/     ← placeholder
├── epcis-fraud-post-market-fraud/      ← placeholder
└── epcis-fraud-regulatory-break/       ← placeholder
```

---

## References

- Vanin et al. (2024) — Decentralized Ledger Technology for EPCIS 2.0. Blockchain 2024: 64–71
- Skilton et al. (2024) — Supply base complexity and diversion risk. DOI: 10.1002/joom.1335
- GS1 EPCIS 2.0 — https://ref.gs1.org/standards/epcis
- DSCSA — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section360eee
- EU FMD — https://eur-lex.europa.eu/eli/reg_del/2016/161/2021-10-11/eng
