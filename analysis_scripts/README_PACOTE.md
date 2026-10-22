# Scripts de analise (faltavam no repositorio)

Esses sao os scripts que pegam o resultado bruto do benchmark (round_scores, logs
do Caliper) e geram os numeros finais que aparecem no Excel/Word que foram
enviados pro grupo. Eles nunca foram commitados no GitHub - so existiam no
computador local da Amanda.

## O que cada um faz

- `direct_detection_accuracy.py` - recalcula TP/FP/TN/FN por evento, excluindo
  a propagacao do LotContaminationRule (e a fonte da Tabela 3c do relatorio).
- `rule_diagnostic.py` - crosstab de quais regras dispararam em cada evento
  (usado pra diagnosticar o problema de saturacao do LogisticsDiversionRule).
- `build_local_reports_v3.py` - gera o Excel e o Word finais (script principal
  do pipeline de relatorio).
- `extract_lote_scores.py`, `fraud_by_drug_report.py`,
  `generate_fraud_pdf_report.py` - relatorios auxiliares/complementares.

## Onde colocar

Dentro de `epcis-blockchain-core/analysis_scripts/` (pasta nova, na raiz do
repo, do lado de `epcis-fraud-logistic-diversion/`).

## Como commitar (rodar dentro da pasta do repo clonado)

```bash
cd ~/Workspace/blockchain-research/epcis-blockchain-core
mkdir -p analysis_scripts
cp /caminho/para/os/6/arquivos/*.py analysis_scripts/
git add analysis_scripts/
git commit -m "docs: adiciona scripts de analise que geram os relatorios (faltavam no repo)"
git push https://MandaMonzon:<SEU_TOKEN>@github.com/MandaMonzon/epcis-blockchain-core.git main
```
