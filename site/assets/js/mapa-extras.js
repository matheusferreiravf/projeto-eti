// Ferramentas do Arduino que não existem nas telas do ETI e ficam aqui no mapa:
// teste e manutenção, quem está na sala, nomes dos cartões, ajustes da placa,
// e as mensagens trocadas com a placa. O registro de eventos e os CSV ficam no relatório.
(function () {
  const el = function (id) { return document.getElementById(id); };

  let eventos = [];
  let config = null;
  let online = false;

  /* ---------- Teste e manutenção ---------- */

  function avisar(txt) {
    const p = el('extras-msg');
    p.textContent = txt;
    p.hidden = false;
    clearTimeout(avisar.timer);
    avisar.timer = setTimeout(function () { p.hidden = true; }, 3000);
  }

  el('btn-mov').addEventListener('click', function () {
    ETI.data.enviarComando('MOV');
    avisar('Movimento enviado para o Arduino.');
  });

  el('btn-zerar').addEventListener('click', function () {
    if (!confirm('Zerar a contagem de pessoas no Arduino?')) return;
    ETI.data.enviarComando('ZERAR');
    avisar('Contagem zerada.');
  });

  /* ---------- Quem está na sala ---------- */

  function desenharPresentes() {
    const lista = ETI.data.presentes();
    el('presentes').innerHTML = lista.length
      ? '<table class="table"><tbody>' + lista.map(function (p) {
          return '<tr><td>' + ETI.ui.escapar(ETI.data.nomeCartao(p.cartao)) + '</td>' +
            '<td class="n">desde ' + ETI.ui.hora(p.desde) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="legenda mt-0">Ninguém registrado pelo cartão.</p>';
  }

  /* ---------- Nomes dos cartões ---------- */

  function cartoesVistos() {
    const uids = new Set(Object.keys((config && config.nomes) || {}));
    eventos.forEach(function (e) { if (e.cartao) uids.add(String(e.cartao)); });
    return Array.from(uids).sort();
  }

  function desenharCartoes() {
    // Não redesenha enquanto alguém digita um nome (perderia o que foi escrito).
    if (el('cartoes').contains(document.activeElement)) return;
    const uids = cartoesVistos();
    el('cartoes').innerHTML = uids.length
      ? uids.map(function (uid) {
          const nome = (config && config.nomes && config.nomes[uid]) || '';
          return '<div class="d-flex gap-2 mb-2 align-items-center">' +
            '<code style="min-width: 7em">' + ETI.ui.escapar(uid) + '</code>' +
            '<input class="form-control form-control-sm" type="text" maxlength="30" placeholder="Nome da pessoa" ' +
            'data-uid="' + ETI.ui.escapar(uid) + '" value="' + ETI.ui.escapar(nome) + '"></div>';
        }).join('')
      : '<p class="legenda mt-0">Nenhum cartão lido ainda.</p>';
  }

  el('cartoes').addEventListener('change', function (e) {
    const uid = e.target.dataset.uid;
    if (uid) ETI.data.setNomeCartao(uid, e.target.value.trim());
  });

  /* ---------- Ajustes da placa ---------- */

  const campos = ['tempoInatividade', 'capacidade', 'umidMin', 'umidMax', 'equipMax'];

  function preencherAjustes() {
    if (!config || el('form-ajustes').contains(document.activeElement)) return;
    campos.forEach(function (c) { el('aj-' + c).value = config[c]; });
  }

  el('form-ajustes').addEventListener('submit', function (e) {
    e.preventDefault();
    const v = {};
    campos.forEach(function (c) { v[c] = Number(el('aj-' + c).value); });
    ETI.data.setConfig({
      tempoInatividade: Math.max(5, Math.round(v.tempoInatividade || 30)),
      capacidade: Math.max(1, Math.round(v.capacidade || 40)),
      umidMin: v.umidMin,
      umidMax: v.umidMax,
      equipMax: v.equipMax
    });
    el('ajustes-ok').hidden = false;
    setTimeout(function () { el('ajustes-ok').hidden = true; }, 2500);
  });

  /* ---------- Mensagens com a placa ---------- */

  if (ETI.gateway && ETI.gateway.suportado) {
    ETI.gateway.onEstado(function (s) {
      el('bloco-mensagens').hidden = !s.conectado;
      el('mensagens').textContent = s.linhas.map(function (l) {
        return (l.dir === 'out' ? '→ ' : '← ') + l.txt;
      }).join('\n');
    });
  }

  function atualizarBotoes() {
    el('btn-mov').disabled = !online;
    el('btn-zerar').disabled = !online;
  }

  ETI.auth.onUsuario(function (u) {
    if (!u) return;
    ETI.data.onEventos(function (lista) {
      eventos = lista;
      desenharPresentes();
      desenharCartoes();
    });
    ETI.data.onConfig(function (c) {
      config = c;
      desenharCartoes();
      desenharPresentes();
      preencherAjustes();
    });
    setInterval(function () { online = ETI.data.online(); atualizarBotoes(); }, 1000);
  });
  atualizarBotoes();
})();
