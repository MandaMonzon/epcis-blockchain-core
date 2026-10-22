"""Gera RELATORIO.md (formato cientifico) a partir dos JSON do avaliar_regras.js.

Uso: python3 gerar_relatorio.py <saida.md> <meta.json> <rotulo=resultado.json> [...]
Cada resultado vira uma secao (ex.: "Dataset completo", "Prevalencia 1%").
"""
import json
import math
import sys

NEG = {'none', 'recalled'}


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def fmt(k, n):
    if n == 0:
        return 'n/a'
    lo, hi = wilson(k, n)
    return f'{100 * k / n:.1f}% ({k}/{n}; IC95% {100 * lo:.1f}-{100 * hi:.1f}%)'


def secao(titulo, r):
    tp, fn, fp, tn = r['tp'], r['fn'], r['fp'], r['tn']
    pos, neg = tp + fn, fp + tn
    out = [f'## {titulo}', '',
           f"Dataset `{r['dataset']}` | limiar de deteccao: score >= {r['threshold']} | "
           f'{pos + neg} transacoes ({pos} com anomalia injetada, {neg} sem) | '
           f'prevalencia de anomalias: {100 * pos / (pos + neg):.2f}%', '',
           '| | Predito anomalo | Predito normal |', '|---|---|---|',
           f'| **Anomalia real** | VP = {tp} | FN = {fn} |',
           f'| **Normal real** | FP = {fp} | VN = {tn} |', '',
           f'- Sensibilidade (recall): {fmt(tp, pos)}',
           f'- Taxa de falsos positivos: {fmt(fp, neg)}',
           f'- Especificidade: {fmt(tn, neg)}',
           f'- Precisao (VPP): {fmt(tp, tp + fp)}', '',
           '| Tipo | Transacoes | Marcadas | Taxa (IC95%) |', '|---|---|---|---|']
    for t, s in sorted(r['stats'].items()):
        rot = t + (' (controle negativo)' if t in NEG else '')
        out.append(f"| {rot} | {s['n']} | {s['flagged']} | {fmt(s['flagged'], s['n'])} |")
    out.append('')
    if r['causes']:
        out += ['Erros por causa:', '']
        out += [f'- {n}x {k}' for k, n in sorted(r['causes'].items(), key=lambda x: -x[1])]
        out.append('')
    return out


def main():
    dst, meta_path, *pares = sys.argv[1:]
    meta = json.load(open(meta_path))
    out = ['# Relatorio de avaliacao das regras de deteccao (EPCIS / Hyperledger Fabric)', '',
           '## 1. Metodo', '',
           'Cada transacao do dataset sintetico e reproduzida isoladamente (ledger novo), '
           'com os eventos em ordem cronologica, passando pelo `RuleEngine` do chaincode. '
           'A transacao e marcada como anomala se algum evento atinge o score do limiar; '
           'tambem roda a auditoria periodica de despachos sem recebimento. '
           'Rotulos (verdade) vem de `scenario_template.csv` (coluna `anomaly_type`); '
           '`none` e `recalled` sao controles negativos. Intervalos: Wilson 95%.', '',
           '## 2. Reprodutibilidade', '']
    out += [f'- {k}: `{v}`' for k, v in meta.items()]
    out.append('')
    for i, par in enumerate(pares):
        rot, path = par.split('=', 1)
        out += secao(f'{i + 3}. {rot}', json.load(open(path)))
    out += ['## Limitacoes', '',
            '- Os dados sao **sinteticos**: anomalias injetadas por um gerador a partir de transacoes '
            'reais do ARCOS (DEA). As regras e o gerador foram ajustados em conjunto, portanto '
            'recall/precisao medem consistencia entre os dois, **nao** desempenho em dados reais.',
            '- Cada tipo de anomalia tem um padrao deterministico; a taxa de 100% nao implica '
            'robustez a fraudes reais, que variam mais.',
            '- A avaliacao e por transacao isolada; interacoes entre transacoes (estado compartilhado '
            'no ledger) so sao exercitadas no teste de carga (Caliper), nao aqui.',
            '- O teste de carga mede desempenho (TPS, latencia), nao acuracia de deteccao.', '']
    open(dst, 'w').write('\n'.join(out))
    print('escrito', dst)


main()
