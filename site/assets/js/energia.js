(function () {
  if (!ETI.ui.exigirSessao()) return;

  ETI.ui.montarTopo('energia.html');

  let equipamentos = ETI.data.equipamentos();
  const solar = ETI.data.solar();
  let config = null;

  const el = function (id) { return document.getElementById(id); };

  el('custo-instalacao').value = solar.custoInstalacao;
  el('geracao').value = solar.geracaoMensal;
  el('vida-util').value = solar.vidaUtil;

  function dias() { return parseInt(el('dias').value, 10) || 22; }
  function tarifa() { return parseFloat(el('tarifa').value) || 0.92; }
  function kwh(eq) { return (eq.potencia * eq.qtd * eq.horas * dias()) / 1000; }

  const base = ETI.ui.chartBase();

  const grafico = new Chart(el('grafico'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Saldo',
          data: [],
          borderColor: '#07296F',
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 14,
          tension: 0
        },
        {
          label: 'Equilíbrio',
          data: [],
          borderColor: '#8DB6FF',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHitRadius: 0
        }
      ]
    },
    options: Object.assign({}, base.opcoes, {
      plugins: Object.assign({}, base.opcoes.plugins, {
        tooltip: Object.assign({}, base.opcoes.plugins.tooltip, {
          filter: function (ctx) { return ctx.datasetIndex === 0; },
          callbacks: { label: function (ctx) { return ETI.ui.moeda(ctx.parsed.y); } }
        })
      }),
      scales: {
        x: base.eixoX,
        y: Object.assign({}, base.eixoY, {
          ticks: Object.assign({}, base.eixoY.ticks, {
            callback: function (v) { return ETI.ui.numero(v / 1000) + ' mil'; }
          })
        })
      }
    })
  });

  function desenharLinhas() {
    if (!equipamentos.length) {
      el('linhas').innerHTML =
        '<tr><td colspan="7" class="vazio">Nenhum equipamento cadastrado.</td></tr>';
      return;
    }

    el('linhas').innerHTML = equipamentos.map(function (eq, i) {
      const consumo = kwh(eq);
      return '<tr>' +
        '<td>' + ETI.ui.escapar(eq.nome) +
        (eq.detalhe ? '<span class="sub">' + ETI.ui.escapar(eq.detalhe) + '</span>' : '') + '</td>' +
        '<td class="n"><input type="number" min="1" step="1" value="' + eq.qtd + '" data-campo="qtd" data-i="' + i + '"></td>' +
        '<td class="n"><input type="number" min="0" step="1" value="' + eq.potencia + '" data-campo="potencia" data-i="' + i + '"></td>' +
        '<td class="n"><input type="number" min="0" max="24" step="0.5" value="' + eq.horas + '" data-campo="horas" data-i="' + i + '"></td>' +
        '<td class="n">' + ETI.ui.numero(consumo, 1) + '</td>' +
        '<td class="n">' + ETI.ui.moeda(consumo * tarifa()) + '</td>' +
        '<td class="n"><button type="button" class="btn btn-link" data-remover="' + i + '" ' +
        'aria-label="Remover ' + ETI.ui.escapar(eq.nome) + '" title="Remover">' +
        '<i class="bi bi-trash" aria-hidden="true"></i></button></td>' +
        '</tr>';
    }).join('');

    el('linhas').querySelectorAll('input').forEach(function (input) {
      input.addEventListener('input', function () {
        const eq = equipamentos[+input.dataset.i];
        eq[input.dataset.campo] = parseFloat(input.value) || 0;
        ETI.data.setEquipamentos(equipamentos);
        calcular(true);
      });
    });

    el('linhas').querySelectorAll('[data-remover]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        equipamentos.splice(+btn.dataset.remover, 1);
        ETI.data.setEquipamentos(equipamentos);
        calcular();
      });
    });
  }

  function calcular(preservarLinhas) {
    if (!config) return;

    solar.custoInstalacao = parseFloat(el('custo-instalacao').value) || 0;
    solar.geracaoMensal = parseFloat(el('geracao').value) || 0;
    solar.vidaUtil = parseInt(el('vida-util').value, 10) || 25;
    ETI.data.setSolar(solar);

    if (!preservarLinhas) desenharLinhas();

    const totalKwh = equipamentos.reduce(function (s, eq) { return s + kwh(eq); }, 0);
    const totalCusto = totalKwh * tarifa();

    el('total-kwh').textContent = ETI.ui.numero(totalKwh, 1);
    el('total-custo').textContent = ETI.ui.moeda(totalCusto);

    const maior = equipamentos.slice().sort(function (a, b) { return kwh(b) - kwh(a); })[0];
    el('resumo').innerHTML = maior
      ? 'A sala consome cerca de <em>' + ETI.ui.numero(totalKwh) + ' kWh por mês</em>, ' +
        ETI.ui.moeda(totalCusto) + ' na tarifa atual. O maior peso é ' +
        ETI.ui.escapar(maior.nome.toLowerCase()) + '.'
      : 'Cadastre os equipamentos para ver o consumo da sala.';

    const potenciaTotal = equipamentos.reduce(function (s, eq) { return s + eq.potencia * eq.qtd; }, 0);
    const kwhEvitado = (potenciaTotal * (parseFloat(el('horas-evitadas').value) || 0) * dias()) / 1000;
    const economia = kwhEvitado * tarifa();

    el('economia-mes').textContent = ETI.ui.moeda(economia);
    el('economia-kwh').textContent = ETI.ui.numero(kwhEvitado, 1) + ' kWh';
    el('economia-ano').textContent = ETI.ui.moeda(economia * 12);

    const coberto = Math.min(totalKwh, solar.geracaoMensal);
    const economiaSolar = coberto * tarifa();

    el('solar-mes').textContent = ETI.ui.moeda(economiaSolar);
    el('solar-cobertura').textContent =
      ETI.ui.numero(totalKwh > 0 ? (coberto / totalKwh) * 100 : 0) + '%';

    const prazo = economiaSolar > 0
      ? ETI.ui.prazo(solar.custoInstalacao / economiaSolar)
      : null;

    el('payback').textContent = prazo || '—';
    el('payback-nota').textContent = prazo
      ? 'Economizando ' + ETI.ui.moeda(economiaSolar) + ' por mês, a instalação de ' +
        ETI.ui.moeda(solar.custoInstalacao) + ' se paga nesse prazo.'
      : 'Sem consumo ou sem geração não há economia para amortizar o investimento.';

    el('solar-saldo').textContent =
      ETI.ui.moeda(economiaSolar * 12 * solar.vidaUtil - solar.custoInstalacao);

    const labels = [];
    const saldo = [];
    const zero = [];
    for (let ano = 0; ano <= solar.vidaUtil; ano++) {
      labels.push(ano === 0 ? 'hoje' : 'ano ' + ano);
      saldo.push(economiaSolar * 12 * ano - solar.custoInstalacao);
      zero.push(0);
    }

    grafico.data.labels = labels;
    grafico.data.datasets[0].data = saldo;
    grafico.data.datasets[1].data = zero;
    grafico.update('none');
  }

  ETI.data.onConfig(function (c) {
    config = c;
    const ativo = document.activeElement;
    if (!ativo || ativo.tagName !== 'INPUT') {
      el('tarifa').value = c.tarifa;
      el('dias').value = c.diasLetivos;
    }
    calcular(ativo && ativo.tagName === 'INPUT');
  });

  el('form-novo').addEventListener('submit', function (e) {
    e.preventDefault();
    equipamentos.push({
      id: 'eq' + Date.now(),
      nome: el('novo-nome').value.trim(),
      detalhe: '',
      qtd: parseInt(el('novo-qtd').value, 10) || 1,
      potencia: parseFloat(el('novo-pot').value) || 0,
      horas: parseFloat(el('novo-horas').value) || 0
    });
    ETI.data.setEquipamentos(equipamentos);
    el('novo-nome').value = '';
    calcular();
  });

  ['horas-evitadas', 'custo-instalacao', 'geracao', 'vida-util'].forEach(function (id) {
    el(id).addEventListener('input', function () { calcular(true); });
  });

  el('dias').addEventListener('input', function () {
    ETI.data.setConfig({ diasLetivos: dias() });
  });

  el('tarifa').addEventListener('input', function () {
    ETI.data.setConfig({ tarifa: tarifa() });
  });
})();
