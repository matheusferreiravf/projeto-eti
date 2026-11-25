window.ETI = window.ETI || {};

// Camada de dados do ETI ligada ao Firebase e ao Arduino.
// As páginas do ETI (dashboard, energia, avisos, relatório, painel) usam a mesma API da versão
// simulada (onTelemetria, onEstado, onConfig, onAlertas, onHistorico...). A diferença é a origem:
// as leituras vêm do Arduino (pela ponte serial.js) e tudo fica guardado no Firebase.
// O mapa e a ponte usam a parte de baixo da API (onStatus, onEventos, enviarComando...).

(function () {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const db = firebase.database();
  const raiz = db.ref('sala');

  const DURACAO_OVERRIDE = 3 * 3600000; // "marcar ocupada/vazia" vale por 3 horas

  const CONFIG_PADRAO = {
    salaNome: 'Sala 12',
    salaBloco: 'Bloco B',
    capacidade: 40,
    limiteTemp: 27,
    limiteLux: 300,           // abaixo disso (lux estimado pelo LDR) está escuro e a luz pode ligar
    horarioEconomia: '23:00', // desligamento programado
    tarifa: 0.92,
    diasLetivos: 22,
    grade: [
      { dia: 1, inicio: '19:00', fim: '22:30' },
      { dia: 2, inicio: '19:00', fim: '22:30' },
      { dia: 3, inicio: '19:00', fim: '22:30' },
      { dia: 4, inicio: '19:00', fim: '22:30' },
      { dia: 5, inicio: '19:00', fim: '22:30' }
    ],
    // Escolhas do usuário
    modoManual: false,        // equipamentos mexidos à mão: automações suspensas
    economiaForcada: false,   // botão "Ativar modo economia"
    ocupacaoManual: null,     // null = segue a grade e o cartão; true/false = marcada à mão
    ocupacaoManualAte: null,  // quando a marcação manual expira
    equipamentos: [
      { id: 'iluminacao', nome: 'Iluminação', detalhe: '8 lâmpadas LED', potencia: 18, qtd: 8, horas: 5 },
      { id: 'ventilacao', nome: 'Ventilação', detalhe: '2 ventiladores de teto', potencia: 120, qtd: 2, horas: 4 },
      { id: 'projetor', nome: 'Projetor', detalhe: 'Projetor multimídia', potencia: 280, qtd: 1, horas: 3 },
      { id: 'ar', nome: 'Ar-condicionado', detalhe: 'Split 12.000 BTU', potencia: 1100, qtd: 1, horas: 4 },
      { id: 'computadores', nome: 'Computadores', detalhe: 'Estações de aluno', potencia: 150, qtd: 10, horas: 4 }
    ],
    solar: { custoInstalacao: 28000, geracaoMensal: 420, vidaUtil: 25 },
    // Ajustes do Arduino (ficam na página do mapa)
    umidMin: 40,
    umidMax: 75,
    equipMax: 40,
    tempoInatividade: 30,
    arSetpoint: 21,
    tempSimAtiva: false,
    tempSimValor: 30,
    nomes: {}
  };

  const CONTROLAVEIS = ['iluminacao', 'ventilacao', 'projetor'];
  const SEM_LEITURA_MS = 15000;
  const LIMITE_EVENTOS = 80;
  const LIMITE_HISTORICO = 120;

  /* ---------- Luminosidade: o LDR vai de 0 a 1023; as telas do ETI falam em lux ----------
     Conversão linear aproximada (0 = escuro total, 1023 ≈ 1000 lux). Serve para comparar com o
     limite, não é um luxímetro. */
  function lux(ldr) { return ldr == null ? null : Math.round(ldr * 1000 / 1023); }
  function ldr(valorLux) { return Math.max(0, Math.min(1023, Math.round(valorLux * 1023 / 1000))); }

  let desvioRelogio = 0;
  db.ref('.info/serverTimeOffset').on('value', function (s) { desvioRelogio = s.val() || 0; });
  function agora() { return Date.now() + desvioRelogio; }

  function clonar(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  /* ---------- Cópia local ----------
     As páginas do ETI leem sala, equipamentos, histórico e regras na hora em que abrem.
     O Firebase demora um instante para responder, então guardamos a última cópia neste navegador. */
  const CACHE = 'eti:cache';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE) || '{}') || {}; } catch (e) { cache = {}; }
  function guardar(chave, valor) {
    cache[chave] = valor;
    try { localStorage.setItem(CACHE, JSON.stringify(cache)); } catch (e) {}
  }

  const valores = {};
  const ouvintes = {};

  function emitir(canal, valor) {
    valores[canal] = valor;
    (ouvintes[canal] || []).forEach(function (fn) { fn(clonar(valor)); });
  }

  function inscrever(canal, fn) {
    (ouvintes[canal] = ouvintes[canal] || []).push(fn);
    if (canal in valores) fn(clonar(valores[canal]));
    return function () {
      ouvintes[canal] = ouvintes[canal].filter(function (f) { return f !== fn; });
    };
  }

  // Emite só se mudou (evita redesenhar a tela à toa).
  const ultimoEmitido = {};
  function emitirSeMudou(canal, valor) {
    const chave = JSON.stringify(valor);
    if (ultimoEmitido[canal] === chave) return;
    ultimoEmitido[canal] = chave;
    emitir(canal, valor);
  }

  function lista(snap) {
    const itens = [];
    snap.forEach(function (filho) {
      const v = filho.val() || {};
      v.id = filho.key;
      itens.push(v);
    });
    return itens;
  }

  function montarConfig(bruto) {
    const c = Object.assign(clonar(CONFIG_PADRAO), bruto || {});
    c.nomes = c.nomes || {};
    c.solar = Object.assign({}, CONFIG_PADRAO.solar, c.solar || {});
    c.grade = Array.isArray(c.grade) ? c.grade.filter(Boolean) : clonar(CONFIG_PADRAO.grade);
    c.equipamentos = Array.isArray(c.equipamentos) ? c.equipamentos.filter(Boolean) : clonar(CONFIG_PADRAO.equipamentos);
    if (c.ocupacaoManual === undefined) c.ocupacaoManual = null;
    // Versões antigas guardavam o limite só no valor do LDR (limiteLuz, de 0 a 1023).
    if (bruto && bruto.limiteLux == null && bruto.limiteLuz != null) c.limiteLux = lux(bruto.limiteLuz);
    c.limiteLuz = ldr(c.limiteLux);
    return c;
  }

  // Começa com a cópia local (ou com o padrão) para as telas já abrirem com dados.
  valores.config = montarConfig(cache.config);
  if (cache.status) valores.status = cache.status;
  valores.historicoBruto = cache.historico || [];
  valores.estadoBruto = cache.estado || {};
  valores.registroAlertas = cache.registroAlertas || [];
  if (cache.avisos) valores.avisos = cache.avisos;

  /* ---------- Login (Firebase Auth) e perfil ---------- */

  const SESSAO = 'eti:sessao';
  function lerSessao() {
    try { return JSON.parse(localStorage.getItem(SESSAO) || 'null'); } catch (e) { return null; }
  }

  // O perfil fica em perfis/<uid> no Firebase: "professor" ou "gestor".
  // Conta sem perfil gravado é gestor (as contas antigas). Se não der para ler, fica como
  // professor, que vê menos coisas (melhor errar para o lado seguro).
  function lerPerfil(uid) {
    return db.ref('perfis/' + uid).once('value')
      .then(function (s) { return s.val() === 'professor' ? 'professor' : 'gestor'; })
      .catch(function () { return 'professor'; });
  }

  let iniciado = false;
  firebase.auth().onAuthStateChanged(function (usuario) {
    if (!usuario) {
      try { localStorage.removeItem(SESSAO); } catch (e) {}
      if (!window.ETI_PAGINA_LOGIN) location.replace('index.html');
      return;
    }
    emitir('usuario', { uid: usuario.uid, email: usuario.email });
    if (window.ETI_PAGINA_LOGIN) return; // a tela de login confere o perfil por conta própria

    lerPerfil(usuario.uid).then(function (perfil) {
      emitir('perfil', perfil);
      const s = lerSessao();
      if (!s || s.perfil !== perfil) {
        // O perfil da conta mudou (ou a sessão sumiu): grava e recarrega a página com o menu certo.
        try {
          localStorage.setItem(SESSAO, JSON.stringify({ perfil: perfil, email: usuario.email, entrouEm: Date.now() }));
        } catch (e) {}
        location.reload();
      }
    });
    if (!iniciado) { iniciado = true; assinar(); }
  });

  function assinar() {
    raiz.child('status').on('value', function (s) {
      emitir('status', s.val());
      guardar('status', s.val());
      recalcular();
    });

    raiz.child('eventos').orderByChild('ts').limitToLast(LIMITE_EVENTOS).on('value', function (s) {
      emitir('eventos', lista(s).reverse());
      recalcular();
    });

    raiz.child('historico').orderByChild('ts').limitToLast(LIMITE_HISTORICO).on('value', function (s) {
      const h = lista(s);
      valores.historicoBruto = h;
      guardar('historico', h);
      emitir('historicoArduino', h);
      emitirHistorico();
    });

    raiz.child('config').on('value', function (s) {
      guardar('config', s.val() || {});
      valores.config = montarConfig(s.val());
      recalcular();
    });

    raiz.child('gateway').on('value', function (s) { emitir('gateway', s.val()); });

    raiz.child('estado').on('value', function (s) {
      valores.estadoBruto = s.val() || {};
      guardar('estado', valores.estadoBruto);
      recalcular();
    });

    raiz.child('alertasRegistro').orderByChild('ts').limitToLast(30).on('value', function (s) {
      const r = lista(s).reverse();
      valores.registroAlertas = r;
      guardar('registroAlertas', r);
      emitirAlertas();
    });

    db.ref('avisos').orderByChild('criadoEm').on('value', function (s) {
      const a = lista(s).reverse();
      guardar('avisos', a);
      emitir('avisos', a);
    });

    db.ref('.info/connected').on('value', function (s) { emitir('conectadoFirebase', !!s.val()); });

    setInterval(recalcular, 2000);
  }

  ETI.auth = {
    entrar: function (email, senha) {
      return firebase.auth().signInWithEmailAndPassword(email, senha);
    },
    perfil: lerPerfil,
    sair: function () {
      try { localStorage.removeItem(SESSAO); } catch (e) {}
      return firebase.auth().signOut().then(function () { location.replace('index.html'); });
    },
    onUsuario: function (fn) { return inscrever('usuario', fn); },
    onPerfil: function (fn) { return inscrever('perfil', fn); }
  };

  function tempSala(st) {
    if (!st) return null;
    return st.sim != null ? st.sim : st.temp;
  }

  function comandosConfig(c) {
    return [
      'LUZMIN ' + ldr(c.limiteLux),
      'TEMPO ' + c.tempoInatividade,
      'LIMITE ' + c.limiteTemp,
      'SETAR ' + c.arSetpoint,
      c.tempSimAtiva ? 'SIM ' + c.tempSimValor : 'SIM OFF'
    ];
  }

  /* ---------- Ocupação, modo economia e potência ---------- */

  function cfg() { return valores.config; }

  function minutos(hhmm) {
    const p = String(hhmm || '00:00').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }

  function minutoAgora() {
    const d = new Date(agora());
    return d.getHours() * 60 + d.getMinutes();
  }

  function overrideAtivo() {
    const c = cfg();
    if (c.ocupacaoManual === null || c.ocupacaoManual === undefined) return false;
    return !c.ocupacaoManualAte || agora() < c.ocupacaoManualAte;
  }

  function ocupadaPelaGrade() {
    const dia = new Date(agora()).getDay();
    const min = minutoAgora();
    return (cfg().grade || []).some(function (f) {
      return f.dia === dia && min >= minutos(f.inicio) && min < minutos(f.fim);
    });
  }

  function online() {
    const st = valores.status;
    return !!(st && st.ts && agora() - st.ts <= SEM_LEITURA_MS);
  }

  // Com o Arduino: tem gente que entrou pelo cartão = ocupada. Sem ninguém, vale o horário de aulas.
  function temGenteNoCartao() {
    const st = valores.status;
    return !!(st && online() && st.pessoas > 0);
  }

  function ocupada() {
    if (overrideAtivo()) return !!cfg().ocupacaoManual;
    return temGenteNoCartao() || ocupadaPelaGrade();
  }

  function motivoEconomia() {
    const c = cfg();
    if (c.economiaForcada) return 'forcada';
    // Alguém marcou a sala como ocupada: vale mais que o horário programado.
    if (overrideAtivo() && c.ocupacaoManual === true) return null;
    if (!ocupada()) return 'vazia';
    if (minutoAgora() >= minutos(c.horarioEconomia)) return 'horario';
    return null;
  }

  // Lâmpada (LED) e ar (ventoinha) são de verdade e vêm do Arduino; os outros ficam no Firebase.
  function ligado(id) {
    const st = valores.status || {};
    if (id === 'iluminacao') return !!st.lampada;
    if (id === 'ar') return !!st.ar;
    return !!(valores.estadoBruto || {})[id];
  }

  function potenciaAtual() {
    return (cfg().equipamentos || []).reduce(function (s, eq) {
      return ligado(eq.id) ? s + eq.potencia * eq.qtd : s;
    }, 0);
  }

  /* ---------- Canais no formato das telas do ETI ---------- */

  function telemetria() {
    const st = valores.status || {};
    return {
      temp: tempSala(st),
      umid: st.umid == null ? null : Math.round(st.umid),
      lux: lux(st.luz),
      potencia: potenciaAtual(),
      pessoas: st.pessoas || 0,
      ts: st.ts || 0
    };
  }

  function estadoTelas() {
    const e = Object.assign({}, valores.estadoBruto || {});
    e.iluminacao = ligado('iluminacao');
    e.ar = ligado('ar');
    return e;
  }

  function configTelas() {
    const c = clonar(cfg());
    const m = motivoEconomia();
    c.motivoEconomia = m;
    c.modoEconomia = m !== null;
    return c;
  }

  function pontoHistorico(p) {
    const q = Object.assign({}, p);
    q.lux = lux(p.luz);
    if (q.potencia == null) q.potencia = 0;
    return q;
  }

  function emitirHistorico() {
    emitir('historico', (valores.historicoBruto || []).map(pontoHistorico));
  }

  function eventoRecente(acao, ms) {
    const ev = (valores.eventos || []).find(function (e) { return e.acao === acao; });
    return ev && agora() - ev.ts < ms ? ev : null;
  }

  function inatividadeAtiva(status) {
    if (!status || !status.pessoas) return null;

    const ev = (valores.eventos || []).find(function (e) {
      return e.acao === 'inatividade' || e.acao === 'entrada' || e.acao === 'saida' ||
        e.acao === 'movimento_virtual' || e.acao === 'zerado' ||
        (e.acao === 'lampada' && e.motivo === 'movimento');
    });
    return ev && ev.acao === 'inatividade' ? ev : null;
  }

  /* ---------- Alertas do sistema ----------
     Cada regra com histerese tem uma condição para disparar e outra (mais folgada) para continuar
     ativa. Isso evita o alerta piscar quando o valor fica oscilando em cima do limite. */
  let alertasAntes = {};

  function calcularAlertas() {
    const st = valores.status;
    const c = cfg();
    const ativos = [];
    function add(id, titulo, texto, desde) {
      ativos.push({ id: id, titulo: titulo, texto: texto,
        desde: desde || (alertasAntes[id] && alertasAntes[id].desde) || agora() });
    }
    function regra(id, disparar, manter, titulo, texto) {
      if (alertasAntes[id] ? manter : disparar) add(id, titulo, texto);
    }

    if (!online()) {
      add('offline', 'Arduino desconectado',
        st && st.ts
          ? 'Nenhuma leitura desde as ' + ETI.ui.hora(st.ts) + '. Ligue o Arduino na USB e clique em "Conectar Arduino" na página do mapa.'
          : 'Ainda não chegou nenhuma leitura. Ligue o Arduino na USB e clique em "Conectar Arduino" na página do mapa.',
        st && st.ts);
      return ativos;
    }

    const intruso = eventoRecente('intruso', 2 * 60000);
    if (intruso) add('intruso', 'Movimento sem cartão',
      'O sensor de presença detectou alguém com a sala vazia, sem passar o cartão.', intruso.ts);

    const inativ = inatividadeAtiva(st);
    if (inativ) add('inatividade', 'Sala parada',
      'Tem ' + st.pessoas + (st.pessoas === 1 ? ' pessoa registrada' : ' pessoas registradas') +
      ', mas nenhum movimento há mais de ' + st.inatividade + ' s. A lâmpada e o ar foram desligados.', inativ.ts);

    const lotada = eventoRecente('lotada', 60000);
    if (lotada) add('lotada', 'Sala lotada', 'Um cartão tentou entrar, mas a sala já está no limite.', lotada.ts);

    const temp = tempSala(st);
    const temGente = ocupada();
    const cap = c.capacidade || 0;
    const pessoas = st.pessoas || 0;
    if (st.temp == null) add('dht', 'Falha no DHT22', 'O sensor de temperatura e umidade não respondeu.');
    if (temp != null) {
      regra('calor', temGente && temp > c.limiteTemp, temGente && temp > c.limiteTemp - 0.5, 'Sala muito quente',
        ETI.ui.numero(temp, 1) + ' °C, acima do limite de ' + ETI.ui.numero(c.limiteTemp, 1) + ' °C. ' +
        (ligado('ventilacao')
          ? 'A ventilação já está ligada; se não baixar, ligue a climatização.'
          : 'Ligue a climatização.'));
      regra('frio', temGente && temp < 18, temGente && temp < 19, 'Sala fria',
        ETI.ui.numero(temp, 1) + ' °C. Desligue a ventilação e feche as janelas.');
    }
    if (st.umid != null) {
      const u = Math.round(st.umid);
      regra('umidade-alta', temGente && u > c.umidMax, temGente && u > c.umidMax - 5, 'Umidade alta',
        'Umidade em ' + u + '%. Ventile a sala.');
      regra('umidade-baixa', temGente && u < c.umidMin, temGente && u < c.umidMin + 5, 'Ar seco',
        'Umidade em ' + u + '%. Recomenda-se umidificar o ambiente e beber água.');
    }
    if (st.luz != null) {
      const l = lux(st.luz);
      const luzLigada = ligado('iluminacao');
      regra('pouca-luz', temGente && l < c.limiteLux && !luzLigada, temGente && l < c.limiteLux + 50 && !luzLigada,
        'Pouca luz', ETI.ui.numero(l) + ' lux, abaixo do mínimo de ' + ETI.ui.numero(c.limiteLux) + ' lux. Ligue a iluminação.');
    }
    regra('lotacao', cap > 0 && pessoas > cap, cap > 0 && pessoas > cap, 'Sala acima da capacidade',
      pessoas + ' pessoas para ' + cap + ' lugares. Remaneje alunos para outra sala.');
    regra('quase-lotada', cap > 0 && pessoas >= Math.ceil(cap * 0.9) && pessoas <= cap,
      cap > 0 && pessoas >= Math.ceil(cap * 0.85) && pessoas <= cap, 'Sala quase lotada',
      pessoas + ' de ' + cap + ' lugares ocupados.');

    if (st.equip == null) add('ds18b20', 'Sem leitura do projetor', 'O sensor DS18B20 do projetor não respondeu.');
    else if (st.equip > c.equipMax) add('equip', 'Projetor superaquecendo',
      'Projetor a ' + ETI.ui.numero(st.equip, 1) + ' °C, acima do limite de ' + c.equipMax + ' °C. Verifique a ventilação ou desligue o aparelho.');

    return ativos;
  }

  function emitirAlertas() {
    emitir('alertas', { ativos: valores.alertasAtivos || [], registro: valores.registroAlertas || [] });
  }

  let ultimoAlertas = null;
  let primeiroCalculo = true;
  function recalcular() {
    const ativos = calcularAlertas();
    const novos = {};
    ativos.forEach(function (a) { novos[a.id] = a; });

    // Só o computador que está com o Arduino grava o histórico de alertas (para não repetir).
    const ponte = ETI.gateway && ETI.gateway.estado && ETI.gateway.estado().conectado;
    if (ponte && !primeiroCalculo) {
      ativos.forEach(function (a) {
        if (alertasAntes[a.id] || a.id === 'offline') return;
        raiz.child('alertasRegistro').push({ tipo: a.id, titulo: a.titulo, texto: a.texto, ts: firebase.database.ServerValue.TIMESTAMP });
      });
    }
    if (valores.status !== undefined) primeiroCalculo = false;
    alertasAntes = novos;

    emitirSeMudou('config', configTelas());
    emitirSeMudou('estado', estadoTelas());
    emitirSeMudou('telemetria', telemetria());

    const chave = JSON.stringify(ativos);
    if (chave === ultimoAlertas) return;
    ultimoAlertas = chave;
    valores.alertasAtivos = ativos;
    emitirAlertas();
  }

  function presentes() {
    const evs = (valores.eventos || []).slice().reverse();
    let dentro = [];
    evs.forEach(function (e) {
      if (e.acao === 'entrada' && e.cartao) dentro.push({ cartao: e.cartao, desde: e.ts });
      else if (e.acao === 'saida') dentro = dentro.filter(function (p) { return p.cartao !== e.cartao; });
      else if (e.acao === 'zerado' || e.acao === 'inicio') dentro = [];
    });
    return dentro;
  }

  function setConfig(parcial) {
    // limiteLux é o que as telas mostram; limiteLuz (0 a 1023) é o que o Arduino entende.
    if (parcial && parcial.limiteLux != null) parcial = Object.assign({}, parcial, { limiteLuz: ldr(parcial.limiteLux) });
    return raiz.child('config').update(parcial);
  }

  /* ---------- API pública ---------- */

  ETI.data = {
    modo: 'arduino',
    controlaveis: CONTROLAVEIS.slice(),
    db: db,
    raiz: raiz,
    agora: agora,
    lux: lux,

    sala: function () {
      const c = cfg();
      return { id: 'sala01', nome: c.salaNome, bloco: c.salaBloco, capacidade: c.capacidade };
    },
    ocupada: ocupada,
    // { ocupada, manual, ate, pelaGrade, pelaPresenca } — de onde vem a ocupação atual
    ocupacao: function () {
      const manual = overrideAtivo();
      return { ocupada: ocupada(), manual: manual, ate: manual ? cfg().ocupacaoManualAte : null,
        pelaGrade: ocupadaPelaGrade(), pelaPresenca: temGenteNoCartao() };
    },
    // { ativo, motivo } — motivo: 'forcada' | 'horario' | 'vazia' | null
    economia: function () {
      const m = motivoEconomia();
      return { ativo: m !== null, motivo: m };
    },
    ligado: ligado,
    potencia: potenciaAtual,

    onTelemetria: function (fn) { return inscrever('telemetria', fn); },
    onEstado: function (fn) { return inscrever('estado', fn); },
    onConfig: function (fn) { return inscrever('config', fn); },
    onAvisos: function (fn) { return inscrever('avisos', fn); },
    onHistorico: function (fn) { return inscrever('historico', fn); },
    onAlertas: function (fn) { return inscrever('alertas', fn); },

    // Ligar ou desligar à mão suspende as automações até "Retomar automações".
    setEstado: function (id, ligar) {
      setConfig({ modoManual: true });
      if (id === 'iluminacao') return ETI.data.enviarComando('LUZ ' + (ligar ? 1 : 0));
      if (id === 'ar') return ETI.data.enviarComando('AR ' + (ligar ? 1 : 0));
      return raiz.child('estado/' + id).set(!!ligar);
    },
    setConfig: setConfig,
    // true = ocupada, false = vazia, null = volta a seguir a grade e o cartão
    setOcupacao: function (valor) {
      if (valor === null) return setConfig({ ocupacaoManual: null, ocupacaoManualAte: null });
      return setConfig({ ocupacaoManual: !!valor, ocupacaoManualAte: agora() + DURACAO_OVERRIDE });
    },
    // A lotação vem do leitor de cartões; não dá para mudar à mão.
    setPessoas: function () {},
    forcarEconomia: function () { return setConfig({ economiaForcada: true }); },
    desativarEconomia: function () { return setConfig({ economiaForcada: false }); },
    // Desfaz tudo que foi feito à mão: economia forçada, equipamentos e ocupação.
    retomarAutomatico: function () {
      return setConfig({ modoManual: false, economiaForcada: false, ocupacaoManual: null, ocupacaoManualAte: null });
    },
    equipamentos: function () { return clonar(cfg().equipamentos || []); },
    setEquipamentos: function (l) { return setConfig({ equipamentos: clonar(l) }); },
    solar: function () { return clonar(cfg().solar); },
    setSolar: function (patch) { return setConfig({ solar: Object.assign({}, cfg().solar, patch) }); },

    addAviso: function (a) {
      return db.ref('avisos').push({
        titulo: a.titulo, texto: a.texto, ativo: true,
        criadoEm: firebase.database.ServerValue.TIMESTAMP
      });
    },
    setAvisoAtivo: function (id, ativo) { return db.ref('avisos/' + id + '/ativo').set(!!ativo); },
    removerAviso: function (id) { return db.ref('avisos/' + id).remove(); },
    limparRegistroAlertas: function () { return raiz.child('alertasRegistro').remove(); },

    // Leituras guardadas (um ponto a cada 30 s, última hora). Sem nenhuma ainda, usa a leitura atual.
    historico: function () {
      const h = (valores.historicoBruto || []).map(pontoHistorico);
      if (h.length) return h;
      const t = telemetria();
      return [{ ts: t.ts || agora(), temp: t.temp || 0, umid: t.umid || 0, lux: t.lux || 0, potencia: t.potencia || 0 }];
    },

    // "Reiniciar dados" do ETI: apaga os dados de teste e zera a contagem no Arduino.
    reiniciar: function () { return ETI.data.limparTudo(); },
    iniciar: function () {},

    /* ---------- Parte do Arduino (mapa e ponte serial) ---------- */

    onStatus: function (fn) { return inscrever('status', fn); },
    onEventos: function (fn) { return inscrever('eventos', fn); },
    onHistoricoArduino: function (fn) { return inscrever('historicoArduino', fn); },
    onRegistroAlertas: function (fn) {
      return inscrever('alertas', function (a) { fn(a.registro); });
    },
    onGateway: function (fn) { return inscrever('gateway', fn); },
    onConectadoFirebase: function (fn) { return inscrever('conectadoFirebase', fn); },

    presentes: presentes,
    tempSala: tempSala,
    comandosConfig: comandosConfig,

    ar: {
      ligar: function (sim) {
        return ETI.data.enviarComando('AR ' + (sim ? 1 : 0));
      },
      setSetpoint: function (graus) {
        graus = Math.max(16, Math.min(30, Math.round(graus)));
        setConfig({ arSetpoint: graus });
        return ETI.data.enviarComando('SETAR ' + graus);
      },
      setSimulada: function (ativa, valor) {
        valor = Math.round(Math.max(0, Math.min(50, Number(valor) || 0)) * 10) / 10;
        setConfig({ tempSimAtiva: !!ativa, tempSimValor: valor });
        return ETI.data.enviarComando(ativa ? 'SIM ' + valor : 'SIM OFF');
      }
    },

    online: online,

    nomeCartao: function (uid) {
      const c = cfg();
      return (c.nomes && c.nomes[uid]) || ('Cartão ' + uid);
    },

    enviarComando: function (cmd) {
      return raiz.child('comandos').push({ cmd: String(cmd), ts: firebase.database.ServerValue.TIMESTAMP });
    },

    setNomeCartao: function (uid, nome) {
      const ref = raiz.child('config/nomes/' + uid);
      return nome ? ref.set(nome) : ref.remove();
    },

    limparEventos: function () { return raiz.child('eventos').remove(); },
    limparHistorico: function () { return raiz.child('historico').remove(); },

    // Apaga os dados de teste: eventos, gráfico, nomes dos cartões e bonecos do mapa.
    // As regras (limites, ar, simulada) ficam. Depois zera a contagem no Arduino.
    limparTudo: function () {
      return raiz.update({
        eventos: null,
        historico: null,
        comandos: null,
        mapa: null,
        estado: null,
        alertasRegistro: null,
        'config/nomes': null
      }).then(function () { return ETI.data.enviarComando('ZERAR'); });
    },

    descreverEvento: function (e) {
      const quem = e.cartao ? ETI.data.nomeCartao(e.cartao) : '';
      switch (e.acao) {
        case 'porta_liberada': return quem + ' passou o cartão. Porta liberada, esperando movimento.';
        case 'entrada': return quem + ' entrou na sala.';
        case 'entrada_cancelada': return quem + ' passou o cartão, mas ninguém entrou.';
        case 'saida': return quem + ' saiu da sala.';
        case 'lotada': return quem + ' tentou entrar, mas a sala está lotada.';
        case 'intruso': return 'Movimento sem cartão com a sala vazia.';
        case 'inatividade': return 'Ninguém se mexeu no tempo limite. Lâmpada apagada.';
        case 'movimento_virtual': return 'Movimento enviado pelo site.';
        case 'zerado': return 'Contagem de pessoas zerada.';
        case 'lampada': {
          const motivos = { entrada: 'alguém entrou no escuro', movimento: 'voltou a ter movimento',
            sala_vazia: 'a sala ficou vazia', inatividade: 'ninguém se mexeu', manual: 'comando do site', zerar: 'contagem zerada',
            fixa: 'luz fixa ligada no site' };
          return 'Lâmpada ' + (e.estado ? 'acesa' : 'apagada') + (motivos[e.motivo] ? ' (' + motivos[e.motivo] + ').' : '.');
        }
        case 'ar': {
          const motivos = { calor: 'sala acima do limite com gente se mexendo', sala_vazia: 'a sala ficou vazia',
            inatividade: 'ninguém se mexeu', manual: 'comando do site', zerar: 'contagem zerada' };
          return 'Ar-condicionado ' + (e.estado ? 'ligado' : 'desligado') + (motivos[e.motivo] ? ' (' + motivos[e.motivo] + ').' : '.');
        }
        case 'inicio': return 'Arduino ligado ou reiniciado.';
        default: return e.acao;
      }
    }
  };

  // Primeira emissão com a cópia local, antes do Firebase responder.
  emitirHistorico();
  recalcular();
})();
