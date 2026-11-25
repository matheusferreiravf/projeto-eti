window.ETI = window.ETI || {};

(function () {
  const TS = firebase.database.ServerValue.TIMESTAMP;
  const INTERVALO_HISTORICO = 30000;
  const COMANDO_VELHO_MS = 30000;

  let porta = null;
  let leitor = null;
  let escritor = null;
  let cancelarComandos = null;
  let ultimoHistorico = 0;
  let timerAutomacoes = null;

  const estado = { conectado: false, erro: null, linhas: [] };
  const ouvintes = [];
  function avisar() { ouvintes.forEach(function (fn) { fn(estado); }); }

  function registrarLinha(txt, direcao) {
    estado.linhas.unshift({ txt: txt, dir: direcao, ts: Date.now() });
    if (estado.linhas.length > 12) estado.linhas.length = 12;
    avisar();
  }

  function tratarLinha(linha) {
    linha = linha.trim();
    if (!linha) return;
    registrarLinha(linha, 'in');

    let msg;
    try { msg = JSON.parse(linha); }
    catch (e) { return; }

    const raiz = ETI.data.raiz;

    if (msg.tipo === 'status') {
      delete msg.tipo;
      msg.ts = TS;
      raiz.child('status').set(msg);

      if (Date.now() - ultimoHistorico >= INTERVALO_HISTORICO) {
        ultimoHistorico = Date.now();
        raiz.child('historico').push({
          temp: ETI.data.tempSala(msg), ar: msg.ar || 0, umid: msg.umid, equip: msg.equip, potencia: ETI.data.potencia(),
          luz: msg.luz, pessoas: msg.pessoas, ts: TS
        });
      }
    } else if (msg.tipo === 'evento' || msg.tipo === 'inicio') {
      if (msg.tipo === 'inicio') msg.acao = 'inicio';
      delete msg.tipo;
      msg.ts = TS;
      raiz.child('eventos').push(msg);

      if (msg.acao === 'inicio') {
        const off = ETI.data.onConfig(function (c) {
          ETI.data.comandosConfig(c).forEach(escrever);
        });
        off();
      }
    }
  }

  async function lerSempre() {
    const decodificador = new TextDecoderStream();
    porta.readable.pipeTo(decodificador.writable).catch(function () {});
    leitor = decodificador.readable.getReader();

    let resto = '';
    try {
      while (true) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += value;
        const partes = resto.split('\n');
        resto = partes.pop();
        partes.forEach(tratarLinha);
      }
    } catch (e) {
      estado.erro = 'A leitura parou: ' + e.message;
    }
    if (estado.conectado) desconectar();
  }

  async function escrever(cmd) {
    if (!escritor) return;
    await escritor.write(new TextEncoder().encode(cmd + '\n'));
    registrarLinha(cmd, 'out');
  }

  /* ---------- Automações da sala (rodam só no computador da ponte) ----------
     O Arduino cuida de entrada, saída, luz e ar. Aqui entram as regras que dependem de
     relógio e de escolhas do site: modo economia (forçado, horário programado, sala vazia),
     controle manual e a ventilação (que não existe na maquete, só no site). */
  const ultimoEnvio = {};
  function enviarUmaVez(cmd) {
    // não repete o mesmo comando em menos de 5 s (o Arduino leva um tempo para responder)
    if (ultimoEnvio[cmd] && Date.now() - ultimoEnvio[cmd] < 5000) return;
    ultimoEnvio[cmd] = Date.now();
    escrever(cmd);
  }

  let stAtual = null, cfgAtual = null, estadoAtual = {};
  let ultimoAuto0 = 0;
  let ultimaConfigEnviada = null;
  ETI.data.onStatus(function (s) { stAtual = s; });
  ETI.data.onConfig(function (c) { cfgAtual = c; enviarConfigSeMudou(); });

  // Regras salvas em qualquer página (limite de temperatura, luz, tempo, ar, simulada)
  // chegam aqui pelo Firebase e são repassadas à placa. Só manda o que mudou.
  function enviarConfigSeMudou() {
    if (!estado.conectado || !cfgAtual) { ultimaConfigEnviada = null; return; }
    const cmds = ETI.data.comandosConfig(cfgAtual);
    if (ultimaConfigEnviada) {
      cmds.forEach(function (cmd, i) { if (cmd !== ultimaConfigEnviada[i]) escrever(cmd); });
    }
    ultimaConfigEnviada = cmds;
  }
  ETI.data.onEstado(function (e) { estadoAtual = e || {}; });

  function automacoes() {
    enviarConfigSeMudou();
    if (!estado.conectado || !stAtual || !cfgAtual) return;
    const eco = ETI.data.economia();
    const raiz = ETI.data.raiz;

    // Automático no Arduino desligado no controle manual e no modo economia. Exceção: economia só
    // porque a sala está vazia (sem marcação à mão). Aí o Arduino já apaga tudo sozinho, e quem
    // entrar pelo cartão precisa que a luz acenda na hora.
    const vaziaNatural = eco.motivo === 'vazia' && !ETI.data.ocupacao().manual;
    const querAuto = !cfgAtual.modoManual && (!eco.ativo || vaziaNatural);
    if (stAtual.auto != null && !!stAtual.auto !== querAuto) enviarUmaVez('AUTO ' + (querAuto ? 1 : 0));
    // Enquanto quiser o automático desligado, repete a cada 20 s: se o site fechar,
    // a placa para de ouvir e volta sozinha para o automático depois de 1 minuto.
    if (!querAuto && Date.now() - ultimoAuto0 > 20000) {
      ultimoAuto0 = Date.now();
      escrever('AUTO 0');
    }

    if (eco.ativo) {
      // Economia: corta tudo.
      if (stAtual.lampada) enviarUmaVez('LUZ 0');
      if (stAtual.ar) enviarUmaVez('AR 0');
      ['ventilacao', 'projetor'].forEach(function (id) {
        if (estadoAtual[id]) raiz.child('estado/' + id).set(false);
      });
      return;
    }

    if (cfgAtual.modoManual) return;

    // Ventilação pelo limite de temperatura, com folga de 1,5 °C para não ficar liga-desliga.
    const t = ETI.data.tempSala(stAtual);
    if (t == null) return;
    if (t > cfgAtual.limiteTemp && !estadoAtual.ventilacao) raiz.child('estado/ventilacao').set(true);
    else if (t < cfgAtual.limiteTemp - 1.5 && estadoAtual.ventilacao) raiz.child('estado/ventilacao').set(false);
  }

  function ouvirComandos() {
    const ref = ETI.data.raiz.child('comandos');
    const fn = ref.on('child_added', function (snap) {
      const c = snap.val() || {};
      snap.ref.remove();
      if (!c.cmd) return;
      if (c.ts && ETI.data.agora() - c.ts > COMANDO_VELHO_MS) return;
      escrever(c.cmd);
    });
    return function () { ref.off('child_added', fn); };
  }

  async function conectar() {
    estado.erro = null;
    try {
      porta = await navigator.serial.requestPort();
      await porta.open({ baudRate: 9600 });
    } catch (e) {
      estado.erro = e.name === 'NotFoundError'
        ? 'Nenhuma porta escolhida.'
        : 'Não deu para abrir a porta. Feche o Monitor Serial do Arduino IDE e tente de novo. (' + e.message + ')';
      porta = null;
      avisar();
      return;
    }

    escritor = porta.writable.getWriter();
    estado.conectado = true;
    ultimoHistorico = 0;

    const gw = ETI.data.raiz.child('gateway');
    gw.set({ online: true, desde: TS, navegador: navigator.userAgent.slice(0, 120) });
    gw.onDisconnect().remove();

    cancelarComandos = ouvirComandos();
    timerAutomacoes = setInterval(automacoes, 2000);
    avisar();
    lerSempre();
  }

  async function desconectar() {
    estado.conectado = false;
    if (cancelarComandos) { cancelarComandos(); cancelarComandos = null; }
    clearInterval(timerAutomacoes);
    ETI.data.raiz.child('gateway').remove();
    try { if (leitor) await leitor.cancel(); } catch (e) {}
    try { if (escritor) escritor.releaseLock(); } catch (e) {}
    try { if (porta) await porta.close(); } catch (e) {}
    leitor = null; escritor = null; porta = null;
    avisar();
  }

  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', function (e) {
      if (porta && e.target === porta) {
        estado.erro = 'O cabo USB do Arduino foi desconectado.';
        desconectar();
      }
    });
  }

  ETI.gateway = {
    suportado: 'serial' in navigator,
    conectar: conectar,
    desconectar: desconectar,
    estado: function () { return estado; },
    onEstado: function (fn) {
      ouvintes.push(fn);
      fn(estado);
      return function () { ouvintes.splice(ouvintes.indexOf(fn), 1); };
    }
  };
})();
