(function () {
  if (!ETI.ui.exigirSessao(true)) return;

  ETI.ui.montarTopo('avisos.html');

  ETI.data.onAvisos(function (avisos) {
    const ativos = avisos.filter(function (a) { return a.ativo; }).length;

    document.getElementById('contagem').textContent = ativos === 0
      ? 'Nada no ar'
      : ativos === 1 ? 'Um aviso no ar' : ativos + ' avisos no ar';

    document.getElementById('lista').innerHTML = avisos.length
      ? avisos.map(function (a) {
          return '<article class="aviso' + (a.ativo ? '' : ' fora') + '">' +
            '<h3>' + ETI.ui.escapar(a.titulo) + '</h3>' +
            '<p>' + ETI.ui.escapar(a.texto) + '</p>' +
            '<div class="meta">' +
            '<span>' + (a.ativo ? 'No ar' : 'Fora do ar') + ' desde ' + ETI.ui.dataHora(a.criadoEm) + '</span>' +
            '<button type="button" class="btn btn-link" data-alternar="' + a.id + '">' +
            '<i class="bi ' + (a.ativo ? 'bi-eye-slash' : 'bi-eye') + '" aria-hidden="true"></i>' +
            (a.ativo ? 'tirar do ar' : 'colocar no ar') + '</button>' +
            '<button type="button" class="btn btn-link" data-remover="' + a.id + '">' +
            '<i class="bi bi-trash" aria-hidden="true"></i>apagar</button>' +
            '</div></article>';
        }).join('')
      : '<p class="vazio">Nenhum aviso cadastrado. O painel vai mostrar só os indicadores da sala.</p>';

    document.querySelectorAll('[data-alternar]').forEach(function (b) {
      b.addEventListener('click', function () {
        const alvo = avisos.find(function (a) { return a.id === b.dataset.alternar; });
        ETI.data.setAvisoAtivo(b.dataset.alternar, !alvo.ativo);
      });
    });

    document.querySelectorAll('[data-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (confirm('Apagar este aviso?')) ETI.data.removerAviso(b.dataset.remover);
      });
    });
  });

  let ultimoRegistro = '';

  ETI.data.onAlertas(function (a) {
    const ativos = {};
    a.ativos.forEach(function (x) { ativos[x.id] = x.desde; });

    const html = a.registro.length
      ? '<div class="table-responsive"><table class="table"><thead><tr>' +
        '<th>Quando</th><th>Alerta</th><th>Mensagem</th><th class="n">Situação</th>' +
        '</tr></thead><tbody>' +
        a.registro.map(function (r) {
          const noAr = ativos[r.tipo] === r.ts;
          return '<tr><td style="white-space:nowrap">' + ETI.ui.dataHora(r.ts) + '</td>' +
            '<td><strong>' + ETI.ui.escapar(r.titulo) + '</strong></td>' +
            '<td>' + ETI.ui.escapar(r.texto) + '</td>' +
            '<td class="n" style="white-space:nowrap">' + (noAr ? 'Ativo' : 'Encerrado') + '</td></tr>';
        }).join('') +
        '</tbody></table></div>'
      : '<p class="vazio" style="padding:0">Nenhum alerta disparado até agora.</p>';

    if (html === ultimoRegistro) return;
    ultimoRegistro = html;
    document.getElementById('registro-alertas').innerHTML = html;
    document.getElementById('acoes-registro').hidden = !a.registro.length;
  });

  document.getElementById('btn-limpar-registro').addEventListener('click', function () {
    if (confirm('Apagar o histórico de alertas? Os alertas ativos continuam valendo.')) {
      ETI.data.limparRegistroAlertas();
    }
  });

  document.getElementById('form-aviso').addEventListener('submit', function (e) {
    e.preventDefault();
    ETI.data.addAviso({
      titulo: document.getElementById('titulo').value.trim(),
      texto: document.getElementById('texto').value.trim()
    });
    this.reset();
    const ok = document.getElementById('publicado');
    ok.hidden = false;
    setTimeout(function () { ok.hidden = true; }, 2500);
  });
})();
