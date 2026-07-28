# epcis-fraud-logistic-diversion

Smart contract for detecting **Logistics Diversion** in pharmaceutical supply chains.
Built on GS1 EPCIS 2.0 and Hyperledger Fabric.

## Architecture

```
EPCIS 2.0 Event (JSON)
        │
        ▼
  Class A Rules (blocking)
  └─ MandatoryFieldsRule    → rejects if required fields are missing
        │ passes
        ▼
  Ledger write (immutable)
        │
        ▼
  Class B Rules (risk scoring, score 0–100)
  ├─ LogisticsDiversionRule     → sequence violations, timing, jurisdiction, blocked status
  ├─ SupplyBaseComplexityRule   → too many suppliers per pharmacy (Skilton et al. 2024)
  └─ VolumeFragmentationRule    → fragmented orders from same source in 30-day window
```

## Class B Score Table

| Rule | Condition | Score |
|---|---|---|
| LogisticsDiversionRule | Blocked disposition in transit | +90 |
| LogisticsDiversionRule | Invalid bizStep sequence | +75 |
| LogisticsDiversionRule | Cross-jurisdiction at wrong step | +80 |
| LogisticsDiversionRule | Out-of-order event time | +60 |
| SupplyBaseComplexityRule | ≥ 9 suppliers (99th percentile) | +85 |
| SupplyBaseComplexityRule | 6–8 suppliers | +60 |
| SupplyBaseComplexityRule | 4–5 suppliers | +30 |
| VolumeFragmentationRule | ≥ 20 orders / 30 days | +40 |
| VolumeFragmentationRule | ≥ 10 orders / 30 days | +20 |

Final score is clamped to **[0, 100]**.

## Run tests

```bash
npm install
npm test
```

## Deploy & Benchmark

### Pré-requisitos

```bash
# 1. Baixar Fabric binaries + Docker images (fazer uma vez)
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.7

# 2. Instalar Caliper (fazer uma vez)
npm install --global @hyperledger/caliper-cli@0.6.0
caliper bind --caliper-bind-sut fabric:2.5
```

### Subir a rede e fazer deploy

```bash
cd fabric-samples/test-network

# Subir rede do zero
./network.sh up createChannel -c mychannel -ca

# Deploy — atenção: -ccp aponta para a RAIZ do módulo (onde está o package.json)
# NÃO aponte para a subpasta chaincode/
./network.sh deployCC \
  -ccn logistic-diversion \
  -ccp ../../epcis-blockchain-core/epcis-fraud-logistic-diversion \
  -ccl javascript \
  -ccv 1.0 \
  -ccs 1
```

### Rodar benchmark Caliper

```bash
cd epcis-blockchain-core/epcis-fraud-logistic-diversion/benchmark

caliper launch manager \
  --caliper-workspace . \
  --caliper-benchconfig config.yaml \
  --caliper-networkconfig network.yaml
```

---

## Erros conhecidos e soluções

### ❌ `failed to marshal response: string field contains invalid UTF-8`

**Causa:** o `-ccp` está apontando para a subpasta `chaincode/`, que não tem `package.json`.
O Fabric não consegue empacotar um módulo Node.js sem `package.json` e gera esse erro obscuro.

**Solução:** apontar `-ccp` para a raiz do módulo (`epcis-fraud-logistic-diversion/`), onde o `package.json` existe.

```bash
# ❌ ERRADO
-ccp ../../epcis-blockchain-core/epcis-fraud-logistic-diversion/chaincode

# ✅ CERTO
-ccp ../../epcis-blockchain-core/epcis-fraud-logistic-diversion
```

---

### ❌ `timeout expired while executing transaction` durante `chaincode install`

**Causa:** o `node_modules` está sendo incluído no pacote `.tar.gz` por falta de `.fabricignore` na raiz do módulo.
O pacote fica com ~6MB, causando timeout no peer durante a instalação.

**Solução:** garantir que o arquivo `.fabricignore` existe em `epcis-fraud-logistic-diversion/` (não apenas em `chaincode/`).
O arquivo já está presente neste repositório. O Fabric roda `npm install` automaticamente dentro do container.

---

### ❌ `priv_sk: no such file` no Caliper

**Causa:** o nome do arquivo de chave privada em `benchmark/network.yaml` é fixo como `priv_sk`, mas o Fabric gera um nome com hash (ex: `abc123_sk`).

**Solução:** antes de rodar o Caliper, descobrir o nome real e atualizar o `network.yaml`:

```bash
ls fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore/
# copie o nome que aparecer e substitua em benchmark/network.yaml → clientPrivateKey.path
```

> ⚠️ Esse arquivo muda toda vez que a rede é recriada com `./network.sh down && ./network.sh up`.

---

### ❌ `npm ERR! 403 Forbidden` ao rodar `npm install`

**Causa:** ambientes corporativos (ex: ADP) bloqueiam acesso direto ao `registry.npmjs.org`.

**Solução:** copiar `node_modules` de outra instalação funcional, ou rodar em uma rede sem restrições.
O deploy em si não precisa de `node_modules` local — o container do Fabric instala as dependências sozinho.

---

## References

- Vanin et al. (2026) — Logistics Diversion taxonomy
- Skilton et al. (2024) — Supply base attributes and diversion risk. DOI: 10.1002/joom.1335
- GS1 EPCIS 2.0 — https://ref.gs1.org/standards/epcis
