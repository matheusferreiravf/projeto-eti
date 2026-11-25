(function () {
  if (!ETI.ui.exigirSessao(true)) return;

  ETI.ui.montarTopo('relatorio.html');

  const sala = ETI.data.sala();
  const historico = ETI.data.historico();
  const equipamentos = ETI.data.equipamentos();
  const solar = ETI.data.solar();

  const el = function (id) { return document.getElementById(id); };

  let config = null;
  ETI.data.onConfig(function (c) { config = c; });

  el('identificacao').textContent =
    sala.nome + ', ' + sala.bloco + '. Emitido em ' + ETI.ui.dataExtenso() + '.';

  const indicadores = [
    { nome: 'Temperatura (°C)', campo: 'temp', casas: 1 },
    { nome: 'Umidade relativa (%)', campo: 'umid', casas: 0 },
    { nome: 'Luminosidade (lux)', campo: 'lux', casas: 0 }
  ];

  function resumo(campo) {
    const v = historico.map(function (p) { return p[campo]; });
    return {
      min: Math.min.apply(null, v),
      med: v.reduce(function (a, b) { return a + b; }, 0) / v.length,
      max: Math.max.apply(null, v)
    };
  }

  el('ambiente').innerHTML = indicadores.map(function (ind) {
    const r = resumo(ind.campo);
    return '<tr><td>' + ind.nome + '</td>' +
      '<td class="n">' + ETI.ui.numero(r.min, ind.casas) + '</td>' +
      '<td class="n">' + ETI.ui.numero(r.med, ind.casas) + '</td>' +
      '<td class="n">' + ETI.ui.numero(r.max, ind.casas) + '</td></tr>';
  }).join('');

  const dias = config.diasLetivos;
  const tarifa = config.tarifa;

  function kwh(eq) { return (eq.potencia * eq.qtd * eq.horas * dias) / 1000; }

  let totalKwh = 0;
  el('consumo').innerHTML = equipamentos.map(function (eq) {
    const c = kwh(eq);
    totalKwh += c;
    return '<tr><td>' + ETI.ui.escapar(eq.nome) + '</td>' +
      '<td class="n">' + eq.qtd + '</td>' +
      '<td class="n">' + ETI.ui.numero(eq.potencia) + '</td>' +
      '<td class="n">' + ETI.ui.numero(eq.horas, 1) + '</td>' +
      '<td class="n">' + ETI.ui.numero(c, 1) + '</td>' +
      '<td class="n">' + ETI.ui.moeda(c * tarifa) + '</td></tr>';
  }).join('');

  el('total-kwh').textContent = ETI.ui.numero(totalKwh, 1);
  el('total-custo').textContent = ETI.ui.moeda(totalKwh * tarifa);

  function pares(lista) {
    return lista.map(function (p) {
      return '<tr><td>' + p[0] + '</td><td class="n">' + p[1] + '</td></tr>';
    }).join('');
  }

  el('parametros').innerHTML = pares([
    ['Temperatura para acionar a ventilação', ETI.ui.numero(config.limiteTemp, 1) + ' °C'],
    ['Luminosidade para acionar a iluminação', ETI.ui.numero(config.limiteLux) + ' lux'],
    ['Horário do desligamento programado', config.horarioEconomia],
    ['Tarifa considerada', ETI.ui.moeda(tarifa) + ' por kWh'],
    ['Dias letivos no mês', dias]
  ]);

  const coberto = Math.min(totalKwh, solar.geracaoMensal);
  const economiaSolar = coberto * tarifa;
  const prazo = economiaSolar > 0
    ? ETI.ui.prazo(solar.custoInstalacao / economiaSolar)
    : null;

  el('viabilidade').innerHTML = pares([
    ['Custo estimado da instalação', ETI.ui.moeda(solar.custoInstalacao)],
    ['Geração mensal esperada', ETI.ui.numero(solar.geracaoMensal) + ' kWh'],
    ['Consumo coberto pela geração', ETI.ui.numero(totalKwh > 0 ? (coberto / totalKwh) * 100 : 0) + '%'],
    ['Economia mensal estimada', ETI.ui.moeda(economiaSolar)],
    ['Tempo de retorno', prazo || 'não calculável'],
    ['Saldo em ' + solar.vidaUtil + ' anos',
      ETI.ui.moeda(economiaSolar * 12 * solar.vidaUtil - solar.custoInstalacao)]
  ]);

  el('btn-pdf').addEventListener('click', function () { window.print(); });

  el('btn-csv').addEventListener('click', function () {
    const linhas = [];
    linhas.push(['ETI - Relatorio de consumo']);
    linhas.push([sala.nome + ', ' + sala.bloco]);
    linhas.push(['Emitido em', ETI.ui.dataExtenso()]);
    linhas.push([]);

    linhas.push(['Condicoes ambientais']);
    linhas.push(['Indicador', 'Minima', 'Media', 'Maxima']);
    indicadores.forEach(function (ind) {
      const r = resumo(ind.campo);
      linhas.push([ind.nome, r.min.toFixed(ind.casas), r.med.toFixed(ind.casas), r.max.toFixed(ind.casas)]);
    });
    linhas.push([]);

    linhas.push(['Consumo por equipamento']);
    linhas.push(['Equipamento', 'Quantidade', 'Watts', 'Horas por dia', 'kWh por mes', 'Custo por mes']);
    equipamentos.forEach(function (eq) {
      const c = kwh(eq);
      linhas.push([eq.nome, eq.qtd, eq.potencia, eq.horas, c.toFixed(2), (c * tarifa).toFixed(2)]);
    });
    linhas.push(['Total', '', '', '', totalKwh.toFixed(2), (totalKwh * tarifa).toFixed(2)]);
    linhas.push([]);

    linhas.push(['Leituras registradas']);
    linhas.push(['Data e hora', 'Temperatura', 'Umidade', 'Luminosidade', 'Potencia']);
    historico.forEach(function (p) {
      linhas.push([new Date(p.ts).toLocaleString('pt-BR'), p.temp, p.umid, p.lux, p.potencia]);
    });

    ETI.ui.baixarCsv('eti-relatorio.csv', linhas);
  });
})();
