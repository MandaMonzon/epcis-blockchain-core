
let raw = '';

process.stdin.on('data', d => raw += d).on('end', () => {

  const r = JSON.parse(raw.slice(raw.indexOf('{')));

  const rows = [...r.passes.map(t => [t, true]), ...r.failures.map(t => [t, false])]

    .map(([t, ok]) => ({ type: t.title.split(' ')[0], ok }))

    .sort((a, b) => a.type.localeCompare(b.type));

  console.log('\nRESULTADO POR TIPO DE ANOMALIA\n');

  for (const { type, ok } of rows) {

    const clean = type === 'none' || type === 'recalled';

    const label = type === 'recalled' ? 'recalled (controle negativo: nao deve ser marcada)' : clean ? 'transacao limpa (nao deve ser marcada)' : type;

    const status = ok ? (clean ? 'nao marcada' : 'detectada') : (clean ? 'MARCADA (falso positivo)' : 'NAO detectada');

    console.log((ok ? '  OK    ' : '  FALHA ') + label.padEnd(42) + status);

  }

  console.log('\n' + r.stats.passes + ' de ' + r.stats.tests + ' OK\n');

});

