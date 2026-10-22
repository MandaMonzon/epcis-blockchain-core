# Regras de negócio e cenários de teste

Este documento descreve o que o sistema deve detectar e como. Cada cenário é um teste de aceitação
(Dado/Quando/Então) e corresponde a um tipo de anomalia gerado pelo `epcis-arcos-etl-generator` e a uma
fixture em `test/fixtures/anomalies.json`.

**Limiar de detecção:** score ≥ 70. O score de um evento é o **máximo** entre as regras Classe B que
dispararam. Regras Classe A (campos obrigatórios) bloqueiam o evento.

## Ciclo de vida normal

Cada unidade (SGTIN) segue `commissioning → packing → shipping → receiving`, com envio da UE para
um comprador dos EUA (dados reais de transações do ARCOS/DEA).

## Cenários

### 1. Transação normal (`none`)
- **Dado** uma unidade com o ciclo completo, em ordem e sem desvios
- **Quando** os quatro eventos são processados
- **Então** nenhum evento atinge o score 70

### 2. Lote recolhido (`recalled`, controle negativo)
- **Dado** um lote com disposição de recall, mas ciclo logístico normal
- **Quando** os eventos são processados
- **Então** não é marcado: disposição é metadado, não anomalia logística

### 3. Etapa pulada (`skip_commission`)
- **Dado** uma unidade que chega ao `receiving` sem `commissioning`
- **Quando** o evento de recebimento é processado
- **Então** `SKIPPED_LIFECYCLE_STEP` (75) dispara

### 4. Fora de ordem (`out_of_order`)
- **Dado** um `receiving` registrado antes do `shipping` da mesma unidade
- **Quando** os eventos são processados em ordem de chegada
- **Então** a sequência é inválida. Hoje quem decide é `SKIPPED_LIFECYCLE_STEP` (75); `OUT_OF_ORDER` vale 30 e não decide sozinho

### 5. Trânsito impossível (`impossible_transit`)
- **Dado** um `receiving` menos de `MIN_TRANSIT_DAYS` (3) dias depois do `shipping`
- **Quando** o recebimento é processado
- **Então** `IMPOSSIBLE_TRANSIT_TIME` (85) dispara

### 6. Desvio em trânsito (`transit_diversion`)
- **Dado** um envio com destino declarado A, mas recebimento registrado em B
- **Quando** o recebimento é processado
- **Então** `TRANSIT_DIVERSION` (85) dispara

### 7. Jurisdição (`jurisdiction`)
- **Dado** um evento cuja origem e destino estão em jurisdições diferentes (UE e EUA) em uma etapa que não é de transporte internacional (`shipping` e `receiving` são as etapas permitidas)
- **Quando** o evento é processado
- **Então** `LOGISTICS_DIVERSION_JURISDICTION` (75) dispara. Prefixos GS1 400–440 contam como UE

### 8. Divergência de quantidade (`quantity_discrepancy`)
- **Dado** um contêiner empacotado com N unidades e desempacotado com menos de N·(1 − tolerância)
- **Quando** o `AggregationEvent DELETE` é processado
- **Então** `QUANTITY_DISCREPANCY` (75) dispara. Tolerância atual: 10% (sem fonte citada; ver pendências)

### 9. Remessa sem confirmação (`shipment_divergence`)
- **Dado** um `desadv` (aviso de expedição) sem `recadv` (confirmação de recebimento)
- **Quando** a auditoria periódica roda mais de `SHIPMENT_TRANSIT_DAYS_MAX` (30) dias depois
- **Então** `SHIPMENT_DIVERGENCE` (70) dispara

### 10. Muitos fornecedores (`many_suppliers`)
- **Dado** um comprador que recebe de 9 ou mais distribuidores distintos (percentil 99, Skilton et al. 2024)
- **Quando** o recebimento é processado
- **Então** `SUPPLY_BASE_COMPLEXITY` (85) dispara. Faixas: 4–5 fornecedores = 30, 6–8 = 60, 9 ou mais = 85

### 11. Item no local errado (`item_location_mismatch`)
- **Dado** uma unidade comissionada em um local e recebida em outro sem ter sido enviada
- **Quando** o recebimento é processado
- **Então** hoje é detectado por `SKIPPED_LIFECYCLE_STEP` (75). Não existe regra específica de localização

## Pendências para decisão do grupo

| # | Achado | Impacto |
|---|---|---|
| 1 | `OUT_OF_ORDER` (30) nunca decide; `out_of_order` e `item_location_mismatch` são detectados por `SKIPPED_LIFECYCLE_STEP` | Os rótulos do gerador não correspondem a regras dedicadas |
| 2 | No dataset antigo, `LOGISTICS_DIVERSION_SEQUENCE` (60) disparava em ~51% das transações normais, mas esse dataset tinha ids repetidos. A confirmar no dataset novo com `make mapa` | Pode ser só efeito do bug de dados já corrigido |
| 3 | Tolerância de quantidade 10% e prazo de 30 dias não têm fonte; literatura indica 0,5–1% | Calibração, pendente de decisão |
| 4 | Dados sintéticos e prevalência ~70% | A métrica mede consistência entre gerador e regras, não desempenho real |
