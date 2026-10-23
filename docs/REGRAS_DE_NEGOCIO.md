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

### 8. Quantidade inconsistente (`quantity_mismatch`)
- **Dado** um contêiner empacotado com N unidades e desempacotado com menos de N·(1 − tolerância)
- **Quando** o `AggregationEvent DELETE` é processado
- **Então** `QUANTITY_MISMATCH` (75) dispara. Tolerância atual: 10% (sem fonte citada; ver pendências)

### 9. Remessa sem confirmação (`shipment_receipt_mismatch`)
- **Dado** um `desadv` (aviso de expedição) sem `recadv` (confirmação de recebimento)
- **Quando** a auditoria periódica roda mais de `SHIPMENT_TRANSIT_DAYS_MAX` (30) dias depois
- **Então** `SHIPMENT_RECEIPT_MISMATCH` (70) dispara

### 10. Muitos fornecedores (`many_suppliers`)
- **Dado** um local comprador cujos eventos `receiving`, `stocking` ou `dispensing` listam 9 ou mais partes distintas em entradas de `sourceList` do tipo `possessing_party` ou `owning_party` (acumuladas nos eventos desse local; entradas `location` não são partes) (percentil 99, Skilton et al. 2024)
- **Quando** o recebimento é processado
- **Então** `SUPPLY_BASE_COMPLEXITY` (85) dispara. Faixas: 4–5 fornecedores = 30, 6–8 = 60, 9 ou mais = 85

### 11. Item no local errado (`item_location_mismatch`)
- **Dado** uma unidade comissionada em um local e recebida em outro sem ter sido enviada
- **Quando** o recebimento é processado
- **Então** hoje é detectado por `SKIPPED_LIFECYCLE_STEP` (75). Não existe regra específica de localização

## Pendências para decisão do grupo

| # | Achado | Impacto |
|---|---|---|
| 1 | DECIDIDO: sem regras novas. `out_of_order` já tem código próprio (`LOGISTICS_DIVERSION_TIMING`, score 30, testado), mas fica mascarado pela checagem de sequência quando as duas falham, e o replay offline ordena eventos por tempo, então ele nunca aparece ali. `item_location_mismatch` é uma unidade com `receiving` sem `shipping` anterior, exatamente o que `SKIPPED_LIFECYCLE_STEP` (75) detecta. Uma regra nova duplicaria essa e exigiria um limiar sem fonte | Detectados via `SKIPPED_LIFECYCLE_STEP`; os rótulos estão documentados, não são regras separadas. A ordem real de chegada no ledger não é reproduzida pelo replay offline |
| 2 | RESOLVIDO. `LOGISTICS_DIVERSION_SEQUENCE` disparava em ~50% das transações normais porque o gerador colocava o shipping antes do packing quando commissioning e shipping caíam no mesmo dia (corrigido: shipping fica pelo menos 3h após o commissioning). `VOLUME_FRAGMENTATION` disparava em ~84% porque contava um evento de recebimento por unidade; agora conta pedidos (lotes) distintos. Transações normais não disparam nenhuma regra | A fragmentação precisa de histórico entre transações, então o replay isolado nunca a exercita; ela é coberta por testes unitários |
| 3 | Tolerância de quantidade 10% e prazo de 30 dias não têm fonte; literatura indica 0,5–1% | Calibração, pendente de decisão |
| 4 | Dados sintéticos e prevalência ~70% | A métrica mede consistência entre gerador e regras, não desempenho real |
