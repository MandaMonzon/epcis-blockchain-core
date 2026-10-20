
#!/bin/bash

set -e

EVENTS_JSON="$1"

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
 
if [ ! -f "$EVENTS_JSON" ]; then

  echo "Erro: events.json nao encontrado em $EVENTS_JSON"

  exit 1

fi
 
COUNTS_OUTPUT=$(python3 -c "

import json, sys

with open('$EVENTS_JSON') as f:

    data = json.load(f)

events = data['epcisBody']['eventList']

counts = {'ObjectEvent': 0, 'AggregationEvent': 0, 'TransactionEvent': 0}

for e in events:

    t = e.get('type') or e.get('eventType') or e.get('isA')

    if isinstance(t, list):

        t = t[0] if t else None

    if t in counts:

        counts[t] += 1

total = sum(counts.values())

if total == 0:

    sample_keys = list(events[0].keys()) if events else []

    sys.stderr.write('ERRO: 0 eventos reconhecidos de ' + str(len(events)) + ' totais. Chaves de exemplo: ' + str(sample_keys) + chr(10))

    sys.exit(1)

print(max(counts['ObjectEvent'], 1), max(counts['AggregationEvent'], 1), max(counts['TransactionEvent'], 1))

")

PYRC=$?

if [ $PYRC -ne 0 ]; then

  echo "Erro: nao foi possivel calcular contagens reais de eventos (ver mensagem acima) - NAO gerando config.yaml quebrado"

  exit 1

fi

read OBJ AGG TXN <<< "$COUNTS_OUTPUT"
 
echo "Contagem real de eventos -> ObjectEvent=$OBJ AggregationEvent=$AGG TransactionEvent=$TXN"
 
sed -e "s/__OBJ_TX__/$OBJ/" -e "s/__AGG_TX__/$AGG/" -e "s/__TXN_TX__/$TXN/" \

    "$BENCH_DIR/config.template.yaml" > "$BENCH_DIR/config.yaml"
 
echo "config.yaml atualizado com txNumber real."

