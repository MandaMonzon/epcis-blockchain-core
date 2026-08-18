# epcis-blockchain-core

Smart contracts for detecting pharmaceutical supply chain fraud using **GS1 EPCIS 2.0** and **Hyperledger Fabric**.

Part of the ARCOS → EPCIS 2.0 research pipeline (CNPq / UNISINOS).

---

## Prerequisites

Install everything below before running the network or tests.

### 1. Docker Desktop
Required to run the Hyperledger Fabric network.

- Download: https://www.docker.com/products/docker-desktop
- Minimum: **8 GB RAM** allocated to Docker
- After installing, make sure Docker is running: `docker ps`

### 2. Node.js 18 or higher
Required for the chaincode and Caliper workload.

- Download: https://nodejs.org/en/download (choose LTS)
- Verify: `node --version` → should show `v18.x` or higher

### 3. Hyperledger Fabric binaries + Docker images
Required to start the Fabric network (peer, orderer, CA).

Run the official install script (downloads ~2 GB):
```bash
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.7
```
This creates a `fabric-samples/` folder with the test network and all Docker images.

- Docs: https://hyperledger-fabric.readthedocs.io/en/release-2.5/install.html

### 4. Hyperledger Caliper CLI
Required to run the benchmark workload and measure TPS/latency.

```bash
npm install --global @hyperledger/caliper-cli@0.6.0
caliper bind --caliper-bind-sut fabric:2.5
```

- Docs: https://hyperledger.github.io/caliper/

### 5. Python 3.10+
Required for the ETL pipeline (`epcis-arcos-etl-generator`).

- Download: https://www.python.org/downloads
- No extra packages needed (uses standard library only)

---

## Quick start

### Run unit tests (no Docker needed)
```bash
cd epcis-fraud-logistic-diversion
npm install
npm test
```

### Run the full experiment
```bash
# 1. Generate EPCIS events (in epcis-arcos-etl-generator)
python3 main.py --data data/arcos_raw.gz

# 2. Start the Fabric test network + deploy chaincode
cd fabric-samples/test-network
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn logistic-diversion -ccp ../../epcis-blockchain-core/epcis-fraud-logistic-diversion/chaincode -ccl javascript

# 3. Run Caliper benchmark
cd ../../epcis-blockchain-core/epcis-fraud-logistic-diversion/benchmark
caliper launch manager --caliper-workspace . --caliper-benchconfig config.yaml --caliper-networkconfig network.yaml
```

---

## Repository structure

```
epcis-blockchain-core/
├── epcis-fraud-logistic-diversion/   ← main experiment (ARCOS diversion detection)
│   ├── chaincode/                    ← Hyperledger Fabric chaincode (Node.js)
│   │   ├── lib/
│   │   │   ├── LogisticDiversionContract.js
│   │   │   ├── RuleEngine.js
│   │   │   └── rules/
│   │   │       ├── LogisticsDiversionRule.js
│   │   │       ├── SupplyBaseComplexityRule.js
│   │   │       └── VolumeFragmentationRule.js
│   │   └── constants/
│   │       ├── EpcisConstants.js
│   │       └── RiskScoreConfig.js    ← all risk scores with regulatory source URLs
│   ├── test/                         ← Jest unit tests (11/11 passing)
│   └── benchmark/                    ← Caliper workload (to be configured)
├── epcis-fraud-chemical-adulteration/
├── epcis-fraud-digital-spoof/
├── epcis-fraud-document-falsification/
├── epcis-fraud-physical-tampering/
├── epcis-fraud-post-market-fraud/
└── epcis-fraud-regulatory-break/
```

---

## References

- Vanin et al. (2024) — Decentralized Ledger Technology for EPCIS 2.0. Blockchain 2024: 64–71
- Skilton et al. (2024) — Supply base complexity and diversion risk. DOI: 10.1002/joom.1335
- GS1 EPCIS 2.0 Standard — https://ref.gs1.org/standards/epcis
- FDA 21 CFR §7.41 — https://www.law.cornell.edu/cfr/text/21/7.41
- DSCSA — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section360eee
- EU FMD — https://eur-lex.europa.eu/eli/reg_del/2016/161/2021-10-11/eng
