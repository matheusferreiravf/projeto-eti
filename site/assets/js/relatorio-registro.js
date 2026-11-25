// Registro da sala no relatório: o que o Arduino contou (eventos) e os CSV de eventos e leituras.
(function () {
  let eventos = [];
  let historico = [];

  function desenhar() {
    document.getElementById('eventos').innerHTML = eventos.length
      ? '<div class="table-responsive"><table class="table"><thead><tr>' +
        '<th>Quando</th><th>O que aconteceu</th><th class="n">Pessoas</th>' +
        '</tr></thead><tbody>' +
        eventos.map(function (e) {
          return '<tr><td style="white-space:nowrap">' + ETI.ui.dataHora(e.ts) + '</td>' +
            '<td>' + ETI.ui.escapar(ETI.data.descreverEvento(e)) + '</td>' +
            '<td class="n">' + (e.pessoas == null ? '' : e.pessoas) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>'
      : '<p class="legenda mt-0">Nenhum evento ainda. Conecte o Arduino na página do mapa.</p>';
  }

  document.getElementById('btn-csv-eventos').addEventListener('click', function () {
    const linhas = [['data_hora', 'acao', 'cartao', 'nome', 'pessoas', 'descricao']];
    eventos.slice().reverse().forEach(function (e) {
      linhas.push([ETI.ui.dataHora(e.ts), e.acao, e.cartao || '',
        e.cartao ? ETI.data.nomeCartao(e.cartao) : '', e.pessoas == null ? '' : e.pessoas,
        ETI.data.descreverEvento(e)]);
    });
    ETI.ui.baixarCsv('eventos-sala.csv', linhas);
  });

  document.getElementById('btn-csv-historico').addEventListener('click', function () {
    const linhas = [['data_hora', 'temperatura_c', 'umidade_pct', 'projetor_c', 'luz_0a1023', 'luz_lux', 'pessoas', 'potencia_w']];
    historico.forEach(function (p) {
      linhas.push([ETI.ui.dataHora(p.ts), p.temp, p.umid, p.equip, p.luz, ETI.data.lux(p.luz), p.pessoas,
        p.potencia == null ? '' : p.potencia]);
    });
    ETI.ui.baixarCsv('leituras-sala.csv', linhas);
  });

  document.getElementById('btn-limpar').addEventListener('click', function () {
    if (confirm('Apagar todos os eventos e leituras guardados? Não dá para desfazer.')) {
      ETI.data.limparEventos();
      ETI.data.limparHistorico();
    }
  });

  ETI.data.onEventos(function (e) { eventos = e; desenhar(); });
  ETI.data.onHistoricoArduino(function (h) { historico = h; });
  ETI.data.onConfig(function () { desenhar(); }); // nomes dos cartões
})();
