(function () {
  ETI.ui.montarTopo('mapa.html');

  const L = 900, A = 560, R = 14;
  const PAREDE = { x1: 192, x2: 210 };
  const SALA = { x1: 210, y1: 50, x2: 880, y2: 510 };
  const CORREDOR = { x1: 10, y1: 10, x2: 192, y2: 550 };
  const PORTA = { y1: 252, y2: 328 };
  const PIR = { x: 216, y: 56 };
  const LAMPADA = { x: 560, y: 280 };
  const PROJETOR = { x: 365, y: 265, l: 30, a: 20 };
  const DHT = { x: 870, y: 120 };
  const AR = { x: 852, y: 240, l: 24, a: 100 };
  const RFID = { x: 178, y: 222 };
  const JANELA = { x1: 500, x2: 720 };
  const MESAS = [
    { x: 470, y: 150, l: 120, a: 50 }, { x: 640, y: 150, l: 120, a: 50 },
    { x: 470, y: 370, l: 120, a: 50 }, { x: 640, y: 370, l: 120, a: 50 }
  ];
  const ENTRADA = [{ x: 150, y: 290 }, { x: 265, y: 290 }];
  const SAIDA = [{ x: 245, y: 290 }, { x: 110, y: 290 }];
  const CORES = ['#D1531F', '#2E9E6A', '#7A4FD1', '#C99A06'];
  const VELOCIDADE = 190;
  const INTERVALO_MOV = 4000;
  const PORTA_ENTRADA_MS = 15000;
  const PORTA_PASSAGEM_MS = 7000;
  const INTRUSO = 'INTRUSO';
  const COR_INTRUSO = '#1E1E1E';
  // Volta que o intruso dá dentro da sala (o sensor de presença vê a sala toda).
  const RONDA_INTRUSO = [
    { x: 420, y: 280 }, { x: 780, y: 280 }, { x: 600, y: 470 }, { x: 330, y: 470 },
    { x: 420, y: 280 }, { x: 780, y: 280 }, { x: 600, y: 470 }, { x: 330, y: 470 }
  ];

  const canvas = document.getElementById('mapa');
  const ctx = canvas.getContext('2d');

  let st = {};
  let online = false;
  let iniciado = false;
  const bonecos = {};
  const ordem = [];
  let selecionado = null;
  const portaPara = {};
  let ultimoMovEnviado = 0;
  let ultimoEnvioPos = 0;
  let avisoMov = 0;
  let avisoIntruso = 0;
  let avisoRfid = 0;
  const vistos = new Set();
  let primeiraCarga = true;
  const teclas = {};
  let refBonecos = null;
  let config = {};


  function agora() { return Date.now(); }

  function portaAberta(uid) { return (portaPara[uid] || 0) > agora(); }
  function algumaPortaAberta() { return Object.keys(portaPara).some(portaAberta) || !!st.porta; }

  function naSala(x) { return x > PAREDE.x2 - 2; }

  function permitido(uid, x, y) {
    if (x - R >= SALA.x1 && x + R <= SALA.x2 && y - R >= SALA.y1 && y + R <= SALA.y2) return true;
    if (x - R >= CORREDOR.x1 && x + R <= CORREDOR.x2 && y - R >= CORREDOR.y1 && y + R <= CORREDOR.y2) return true;
    return portaAberta(uid) && y - R >= PORTA.y1 && y + R <= PORTA.y2 && x - R >= CORREDOR.x1 && x + R <= SALA.x2;
  }

  function naZonaPir(x, y) {
    return x > SALA.x1 + R && x < SALA.x2 && y > SALA.y1 && y < SALA.y2;
  }

  function nome(uid) {
    if (uid === INTRUSO) return 'Intruso';
    return ETI.data.nomeCartao(uid).replace(/^Cartão /, '');
  }

  function criarBoneco(uid) {
    if (bonecos[uid]) return bonecos[uid];
    const i = ordem.length;
    const dentro = ETI.data.presentes().some(function (p) { return p.cartao === uid; });
    const b = {
      uid: uid, cor: CORES[i % CORES.length],
      x: dentro ? 300 + (i % 3) * 60 : 100, y: dentro ? 300 + Math.floor(i / 3) * 60 : 120 + i * 70,
      caminho: [], local: 0, remoto: null
    };
    bonecos[uid] = b;
    ordem.push(uid);
    if (!selecionado) selecionado = uid;
    desenharLista();
    return b;
  }

  function andarPor(b, pontos, segurarPorta) {
    if (segurarPorta) portaPara[b.uid] = Math.max(portaPara[b.uid] || 0, agora() + PORTA_PASSAGEM_MS);
    b.caminho = pontos.map(function (p) { return { x: p.x, y: p.y }; });
  }

  function caminhoAte(b, alvo) {
    const origemSala = naSala(b.x), destinoSala = naSala(alvo.x);
    if (origemSala === destinoSala || !portaAberta(b.uid)) return [alvo];
    return (destinoSala ? ENTRADA : SAIDA).concat([alvo]);
  }

  function tentar(b, nx, ny) {
    const ax = b.x, ay = b.y;
    if (permitido(b.uid, nx, b.y)) b.x = nx;
    if (permitido(b.uid, b.x, ny)) b.y = ny;
    return b.x !== ax || b.y !== ay;
  }

  function aposMoverLocal(b) {
    b.local = agora();
    if (agora() - ultimoEnvioPos > 150) {
      ultimoEnvioPos = agora();
      salvarPosicao(b);
    }
    if (naZonaPir(b.x, b.y) && agora() - ultimoMovEnviado > INTERVALO_MOV) {
      ultimoMovEnviado = agora();
      avisoMov = agora();
      if (online) ETI.data.enviarComando('MOV');
    }
  }

  function passo(dt) {
    ordem.forEach(function (uid) {
      const b = bonecos[uid];
      let mexeu = false;
      let doUsuario = false;

      if (uid === selecionado) {
        let dx = 0, dy = 0;
        if (teclas.ArrowLeft || teclas.a) dx -= 1;
        if (teclas.ArrowRight || teclas.d) dx += 1;
        if (teclas.ArrowUp || teclas.w) dy -= 1;
        if (teclas.ArrowDown || teclas.s) dy += 1;
        if (dx || dy) {
          const n = Math.hypot(dx, dy);
          b.caminho = [];
          mexeu = tentar(b, b.x + dx / n * VELOCIDADE * dt, b.y + dy / n * VELOCIDADE * dt);
          doUsuario = true;
        }
      }

      if (!doUsuario && b.caminho.length) {
        const alvo = b.caminho[0];
        const dist = Math.hypot(alvo.x - b.x, alvo.y - b.y);
        const p = VELOCIDADE * dt;
        if (dist <= p) {
          mexeu = tentar(b, alvo.x, alvo.y);
          b.caminho.shift();
        } else {
          mexeu = tentar(b, b.x + (alvo.x - b.x) / dist * p, b.y + (alvo.y - b.y) / dist * p);
          if (!mexeu) b.caminho = [];
        }
        doUsuario = !!b.peloUsuario && mexeu;
        if (!b.caminho.length) {
          if (!b.peloUsuario) delete portaPara[uid];
          salvarPosicao(b);
          b.peloUsuario = false;
        }
      }

      if (mexeu && doUsuario) aposMoverLocal(b);

      if (!mexeu && b.remoto && agora() - b.local > 1500 && !b.caminho.length) {
        b.x += (b.remoto.x - b.x) * 0.25;
        b.y += (b.remoto.y - b.y) * 0.25;
        if (Math.hypot(b.remoto.x - b.x, b.remoto.y - b.y) < 0.5) b.remoto = null;
      }
    });
  }

  function tratarEvento(e) {
    const c = e.cartao;
    const b = c ? criarBoneco(c) : null;
    switch (e.acao) {
      case 'porta_liberada':
        portaPara[c] = agora() + PORTA_ENTRADA_MS;
        avisoRfid = agora();
        selecionado = c;
        desenharLista();
        break;
      case 'entrada':
        if (!naSala(b.x)) andarPor(b, ENTRADA, true);
        else delete portaPara[c];
        break;
      case 'entrada_cancelada':
        delete portaPara[c];
        if (naSala(b.x) || b.x + R > CORREDOR.x2) andarPor(b, SAIDA, true);
        break;
      case 'saida':
        avisoRfid = agora();
        if (naSala(b.x) || b.x + R > CORREDOR.x2) andarPor(b, SAIDA, true);
        break;
      case 'zerado':
      case 'inicio':
        ordem.forEach(function (uid) {
          if (uid !== INTRUSO && naSala(bonecos[uid].x)) andarPor(bonecos[uid], SAIDA, true);
        });
        break;
      case 'intruso':
        avisoIntruso = agora();
        if (bonecos[INTRUSO]) mostrarCenario('O Arduino detectou movimento sem cartão: alerta de intruso disparado!');
        break;
    }
  }

  // Se os dados de teste foram apagados, some com os bonecos que não aparecem mais.
  function removerSemEventos(lista) {
    const usados = new Set(lista.map(function (e) { return e.cartao; }).filter(Boolean));
    ordem.slice().forEach(function (uid) {
      if (usados.has(uid) || uid === INTRUSO) return;
      delete bonecos[uid];
      ordem.splice(ordem.indexOf(uid), 1);
      if (selecionado === uid) selecionado = ordem[0] || null;
    });
    desenharLista();
  }

  function receberEventos(lista) {
    removerSemEventos(lista);
    lista.forEach(function (e) { if (e.cartao) criarBoneco(e.cartao); });
    if (primeiraCarga) {
      lista.forEach(function (e) { vistos.add(e.id); });
      primeiraCarga = false;
    } else {
      lista.slice().reverse().forEach(function (e) {
        if (vistos.has(e.id)) return;
        vistos.add(e.id);
        tratarEvento(e);
      });
    }
    desenharEventos(lista);
  }

  function receberPosicoes(snap) {
    const v = snap.val() || {};
    const presentes = ETI.data.presentes().map(function (p) { return p.cartao; });
    Object.keys(v).forEach(function (uid) {
      const b = criarBoneco(uid);
      if (agora() - b.local < 1500 || b.caminho.length) return;
      if (naSala(v[uid].x) !== presentes.includes(uid)) return;
      b.remoto = { x: v[uid].x, y: v[uid].y };
    });
  }

  function salvarPosicao(b) {
    if (b.uid === INTRUSO) return;
    if (refBonecos) refBonecos.child(b.uid).set({ x: Math.round(b.x), y: Math.round(b.y), ts: firebase.database.ServerValue.TIMESTAMP });
  }

  function retang(x, y, l, a, raio) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, l, a, raio || 0) : ctx.rect(x, y, l, a);
  }

  function texto(t, x, y, cor, tam, alinhar, peso) {
    ctx.font = (peso || 500) + ' ' + (tam || 13) + 'px Inter, system-ui, sans-serif';
    ctx.textAlign = alinhar || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cor || '#07296F';
    ctx.fillText(t, x, y);
  }

  function etiqueta(t, x, y) {
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const l = ctx.measureText(t).width + 14;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    retang(x - l / 2, y - 11, l, 22, 11);
    ctx.fill();
    ctx.strokeStyle = '#DFE7F5';
    ctx.lineWidth = 1;
    ctx.stroke();
    texto(t, x, y + 0.5, '#07296F', 12, 'center', 600);
  }

  function num(v, casas) { return v == null ? '—' : ETI.ui.numero(v, casas); }

  function desenhar() {
    const s = canvas.width / L;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const t = agora();
    const claro = st.claro === 1 || st.claro === true;
    const lampada = !!st.lampada;

    ctx.fillStyle = claro ? '#E9EEF7' : '#C9D1E2';
    ctx.fillRect(0, 0, L, A);
    texto('Corredor', 100, 30, '#5A6C9C', 12);

    ctx.fillStyle = '#FBFCFF';
    ctx.fillRect(SALA.x1, SALA.y1, SALA.x2 - SALA.x1, SALA.y2 - SALA.y1);
    ctx.strokeStyle = '#EEF2FA';
    ctx.lineWidth = 1;
    for (let gx = SALA.x1 + 40; gx < SALA.x2; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, SALA.y1); ctx.lineTo(gx, SALA.y2); ctx.stroke();
    }
    for (let gy = SALA.y1 + 40; gy < SALA.y2; gy += 40) {
      ctx.beginPath(); ctx.moveTo(SALA.x1, gy); ctx.lineTo(SALA.x2, gy); ctx.stroke();
    }

    MESAS.forEach(function (m) {
      ctx.fillStyle = '#E3EDFF';
      retang(m.x, m.y, m.l, m.a, 6); ctx.fill();
      ctx.fillStyle = '#C9D8F5';
      [0.25, 0.75].forEach(function (f) {
        ctx.beginPath(); ctx.arc(m.x + m.l * f, m.y + m.a + 14, 9, 0, Math.PI * 2); ctx.fill();
      });
    });

    const movAtivo = !!st.mov || t - avisoMov < 1500;
    ctx.save();
    ctx.beginPath();
    ctx.rect(SALA.x1 + 6, SALA.y1 + 6, SALA.x2 - SALA.x1 - 12, SALA.y2 - SALA.y1 - 12);
    const pulso = 0.18 + 0.1 * Math.sin(t / 150);
    ctx.fillStyle = movAtivo ? 'rgba(209,83,31,' + pulso + ')' : 'rgba(141,182,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = movAtivo ? 'rgba(209,83,31,0.5)' : 'rgba(141,182,255,0.5)';
    ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();

    // Projetor no teto, apontado para o quadro (parede de cima). O DS18B20 fica colado nele.
    const quente = st.equip != null && st.equip > (config.equipMax || 40);
    if (quente) {
      ctx.beginPath(); ctx.arc(PROJETOR.x + PROJETOR.l / 2, PROJETOR.y + PROJETOR.a / 2, 30 + 4 * Math.sin(t / 150), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224,83,58,0.25)'; ctx.fill();
    }
    ctx.fillStyle = 'rgba(141,182,255,0.18)';
    ctx.beginPath(); ctx.moveTo(PROJETOR.x + 6, PROJETOR.y); ctx.lineTo(PROJETOR.x - 60, SALA.y1 + 4);
    ctx.lineTo(PROJETOR.x + PROJETOR.l + 60, SALA.y1 + 4); ctx.lineTo(PROJETOR.x + PROJETOR.l - 6, PROJETOR.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    retang(PROJETOR.x, PROJETOR.y, PROJETOR.l, PROJETOR.a, 4); ctx.fill();
    ctx.strokeStyle = quente ? '#E0533A' : '#07296F'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(PROJETOR.x + PROJETOR.l / 2, PROJETOR.y + 4, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#07296F'; ctx.fill();
    etiqueta('Projetor ' + num(st.equip, 1) + ' °C' + (quente ? ' · quente!' : ''), PROJETOR.x + PROJETOR.l / 2, PROJETOR.y + PROJETOR.a + 14);

    if (lampada) {
      const g = ctx.createRadialGradient(LAMPADA.x, LAMPADA.y, 10, LAMPADA.x, LAMPADA.y, 330);
      g.addColorStop(0, 'rgba(255,214,90,0.55)');
      g.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(SALA.x1, SALA.y1, SALA.x2 - SALA.x1, SALA.y2 - SALA.y1);
    }
    if (!claro) {
      ctx.fillStyle = lampada ? 'rgba(7,15,40,0.12)' : 'rgba(7,15,40,0.5)';
      ctx.fillRect(SALA.x1, SALA.y1, SALA.x2 - SALA.x1, SALA.y2 - SALA.y1);
    }

    const arLigado = !!st.ar;
    if (arLigado) {
      const g = ctx.createRadialGradient(AR.x, AR.y + AR.a / 2, 10, AR.x, AR.y + AR.a / 2, 420);
      g.addColorStop(0, 'rgba(120,190,255,0.30)');
      g.addColorStop(1, 'rgba(120,190,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(SALA.x1, SALA.y1, SALA.x2 - SALA.x1, SALA.y2 - SALA.y1);
      ctx.save();
      ctx.strokeStyle = 'rgba(60,150,235,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 12]);
      ctx.lineDashOffset = t / 25;
      for (let k = 0; k < 4; k++) {
        const y0 = AR.y + 18 + k * 21;
        ctx.beginPath();
        for (let dx = 0; dx <= 150; dx += 5) {
          const y = y0 + Math.sin((dx + k * 20) / 22) * 6 * (dx / 150);
          if (dx === 0) ctx.moveTo(AR.x - 4 - dx, y); else ctx.lineTo(AR.x - 4 - dx, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.beginPath(); ctx.arc(LAMPADA.x, LAMPADA.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = lampada ? '#FFD65A' : '#B8C2D6'; ctx.fill();
    ctx.strokeStyle = lampada ? '#E0A800' : '#8A96AE'; ctx.lineWidth = 2; ctx.stroke();
    texto('Lâmpada ' + (lampada ? 'acesa' : 'apagada'), LAMPADA.x, LAMPADA.y + 30, claro || lampada ? '#07296F' : '#E3EDFF', 12, 'center', 600);

    ctx.fillStyle = '#07296F';
    ctx.fillRect(SALA.x1 - 18, SALA.y1 - 10, SALA.x2 - SALA.x1 + 28, 10);
    ctx.fillRect(SALA.x1 - 18, SALA.y2, SALA.x2 - SALA.x1 + 28, 10);
    ctx.fillRect(SALA.x2, SALA.y1 - 10, 10, SALA.y2 - SALA.y1 + 20);
    ctx.fillRect(PAREDE.x1, SALA.y1 - 10, PAREDE.x2 - PAREDE.x1, PORTA.y1 - SALA.y1 + 10);
    ctx.fillRect(PAREDE.x1, PORTA.y2, PAREDE.x2 - PAREDE.x1, SALA.y2 - PORTA.y2 + 10);

    ctx.fillStyle = claro ? '#BFE3FF' : '#1B2A55';
    ctx.fillRect(JANELA.x1, SALA.y1 - 10, JANELA.x2 - JANELA.x1, 10);
    texto(claro ? 'Janela · dia' : 'Janela · noite', (JANELA.x1 + JANELA.x2) / 2, SALA.y1 - 24, '#5A6C9C', 11);

    const aberta = algumaPortaAberta();
    ctx.save();
    ctx.translate((PAREDE.x1 + PAREDE.x2) / 2, PORTA.y1);
    ctx.rotate(aberta ? -Math.PI / 2.4 : 0);
    ctx.fillStyle = '#8A5A2B';
    ctx.fillRect(-4, 0, 8, PORTA.y2 - PORTA.y1);
    ctx.restore();
    if (aberta) {
      ctx.fillStyle = 'rgba(46,158,106,0.18)';
      ctx.fillRect(PAREDE.x1, PORTA.y1, PAREDE.x2 - PAREDE.x1, PORTA.y2 - PORTA.y1);
    }
    texto(aberta ? 'Porta aberta' : 'Porta trancada', 100, PORTA.y2 + 22, aberta ? '#2E9E6A' : '#5A6C9C', 12, 'center', 600);

    ctx.fillStyle = '#263247';
    retang(RFID.x - 12, RFID.y - 16, 24, 32, 4); ctx.fill();
    ctx.beginPath(); ctx.arc(RFID.x, RFID.y - 6, 4, 0, Math.PI * 2);
    ctx.fillStyle = aberta ? '#3BD47F' : (t - avisoRfid < 800 ? '#FFD65A' : '#E0533A'); ctx.fill();
    texto('RFID', RFID.x - 38, RFID.y, '#5A6C9C', 11, 'center', 600);

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.moveTo(PIR.x - 6, PIR.y - 6); ctx.arc(PIR.x - 6, PIR.y - 6, 16, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#07296F'; ctx.lineWidth = 2; ctx.stroke();
    texto('Sensor de presença (sala toda)', PIR.x + 22, PIR.y + 14, '#5A6C9C', 11, 'left');

    ctx.fillStyle = '#FFFFFF';
    retang(DHT.x - 8, DHT.y - 14, 16, 28, 3); ctx.fill();
    ctx.strokeStyle = '#07296F'; ctx.lineWidth = 2; ctx.stroke();
    etiqueta(num(ETI.data.tempSala(st), 1) + ' °C' + (st.sim != null ? ' (simulada)' : '') + ' · ' + num(st.umid) + ' %', DHT.x - 90, DHT.y);

    ctx.fillStyle = '#FFFFFF';
    retang(AR.x, AR.y, AR.l, AR.a, 5); ctx.fill();
    ctx.strokeStyle = '#07296F'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = arLigado ? '#3C96EB' : '#B8C2D6'; ctx.lineWidth = 1.5;
    for (let k = 1; k < 6; k++) {
      ctx.beginPath(); ctx.moveTo(AR.x + 5, AR.y + k * AR.a / 6); ctx.lineTo(AR.x + AR.l - 5, AR.y + k * AR.a / 6); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(AR.x + AR.l / 2, AR.y + 8, 3, 0, Math.PI * 2);
    ctx.fillStyle = arLigado ? '#3BD47F' : '#E0533A'; ctx.fill();
    etiqueta('Ar ' + setpointAr() + ' °C · ' + (arLigado ? 'ligado' : 'desligado'), AR.x - 66, AR.y + AR.a + 12);

    etiqueta('Pessoas no Arduino: ' + (st.pessoas == null ? '—' : st.pessoas), SALA.x1 + 95, SALA.y2 - 24);

    ordem.forEach(function (uid) {
      const b = bonecos[uid];
      ctx.beginPath(); ctx.ellipse(b.x, b.y + R - 2, R * 0.9, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(7,41,111,0.18)'; ctx.fill();
      if (uid === selecionado) {
        ctx.beginPath(); ctx.arc(b.x, b.y, R + 6, 0, Math.PI * 2);
        ctx.strokeStyle = b.cor; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
      ctx.fillStyle = b.cor; ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y - 3, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
      etiqueta(nome(uid), b.x, b.y - R - 16);
    });

    if (t - avisoIntruso < 4000) {
      ctx.strokeStyle = 'rgba(209,83,31,' + (0.5 + 0.5 * Math.sin(t / 120)) + ')';
      ctx.lineWidth = 8;
      ctx.strokeRect(SALA.x1 + 4, SALA.y1 + 4, SALA.x2 - SALA.x1 - 8, SALA.y2 - SALA.y1 - 8);
      etiqueta('Movimento sem cartão!', (SALA.x1 + SALA.x2) / 2, SALA.y1 + 34);
    }

    if (!online) {
      ctx.fillStyle = 'rgba(7,41,111,0.85)';
      retang(L / 2 - 230, A - 46, 460, 32, 16); ctx.fill();
      texto('Arduino desconectado: a porta não abre e o movimento não é enviado', L / 2, A - 30, '#FFFFFF', 12, 'center', 600);
    }
  }

  function setpointAr() {
    return st.setar != null && online ? st.setar : (config.arSetpoint || 21);
  }

  const arEstado = document.getElementById('ar-estado');
  const arSetpoint = document.getElementById('ar-setpoint');
  const arLigar = document.getElementById('ar-ligar');
  const simAtiva = document.getElementById('sim-ativa');
  const simValor = document.getElementById('sim-valor');

  function atualizarPainelAr() {
    const temp = ETI.data.tempSala(st);
    arEstado.textContent = (st.ar ? 'Ligado' : 'Desligado') + '. Sala a ' + num(temp, 1) + ' °C' +
      (st.sim != null ? ' (simulada)' : ' (DHT22)') + '; liga com gente se mexendo acima de ' + num(config.limiteTemp || 28, 1) + ' °C.';
    arSetpoint.textContent = setpointAr() + ' °C';
    arLigar.querySelector('span').textContent = st.ar ? 'Desligar' : 'Ligar';
    arLigar.className = 'btn ' + (st.ar ? 'btn-outline-primary' : 'btn-primary');
    arLigar.disabled = !online;
    simAtiva.checked = !!config.tempSimAtiva;
    if (document.activeElement !== simValor && config.tempSimValor != null) simValor.value = config.tempSimValor;
  }

  document.getElementById('ar-menos').addEventListener('click', function () { ETI.data.ar.setSetpoint(setpointAr() - 1); });
  document.getElementById('ar-mais').addEventListener('click', function () { ETI.data.ar.setSetpoint(setpointAr() + 1); });
  arLigar.addEventListener('click', function () { ETI.data.ar.ligar(!st.ar); });
  simAtiva.addEventListener('change', function () { ETI.data.ar.setSimulada(simAtiva.checked, simValor.value); });
  function aplicarSim() { ETI.data.ar.setSimulada(true, simValor.value); }
  document.getElementById('sim-aplicar').addEventListener('click', aplicarSim);
  simValor.addEventListener('keydown', function (e) { if (e.key === 'Enter') aplicarSim(); });

  function redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(largura * A / L * dpr);
  }

  let anterior = performance.now();
  function quadro(t) {
    const dt = Math.min(0.05, (t - anterior) / 1000);
    anterior = t;
    passo(dt);
    desenhar();
    atualizarDica();
    requestAnimationFrame(quadro);
  }

  function pontoDoMapa(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * L, y: (e.clientY - r.top) / r.height * A };
  }

  canvas.addEventListener('pointerdown', function (e) {
    canvas.focus();
    const p = pontoDoMapa(e);
    const tocado = ordem.find(function (uid) { return Math.hypot(bonecos[uid].x - p.x, bonecos[uid].y - p.y) <= R + 6; });
    if (tocado) { selecionado = tocado; desenharLista(); return; }
    const b = bonecos[selecionado];
    if (!b) return;
    b.caminho = caminhoAte(b, p);
    b.peloUsuario = true;
  });

  const MAPA_TECLAS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, w: 1, a: 1, s: 1, d: 1, W: 1, A: 1, S: 1, D: 1 };
  window.addEventListener('keydown', function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !MAPA_TECLAS[e.key]) return;
    e.preventDefault();
    teclas[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
  });
  window.addEventListener('keyup', function (e) {
    if (!MAPA_TECLAS[e.key]) return;
    teclas[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false;
    if (bonecos[selecionado]) salvarPosicao(bonecos[selecionado]);
  });
  window.addEventListener('blur', function () { Object.keys(teclas).forEach(function (k) { teclas[k] = false; }); });

  document.querySelectorAll('[data-tecla]').forEach(function (botao) {
    const k = botao.dataset.tecla;
    function soltar() { teclas[k] = false; }
    botao.addEventListener('pointerdown', function (e) { e.preventDefault(); teclas[k] = true; });
    botao.addEventListener('pointerup', soltar);
    botao.addEventListener('pointerleave', soltar);
    botao.addEventListener('pointercancel', soltar);
  });

  function desenharLista() {
    const el = document.getElementById('lista-bonecos');
    if (!ordem.length) {
      el.innerHTML = '<p class="legenda m-0">Nenhum cartão lido ainda. Passe um cartão no leitor e o boneco dele aparece no corredor.</p>';
      return;
    }
    el.innerHTML = ordem.map(function (uid) {
      const b = bonecos[uid];
      return '<button type="button" class="btn ' + (uid === selecionado ? 'btn-primary' : 'btn-outline-primary') +
        '" data-boneco="' + ETI.ui.escapar(uid) + '"><span class="bola" style="background:' + b.cor + '"></span>' +
        ETI.ui.escapar(nome(uid)) + '</button>';
    }).join('');
    el.querySelectorAll('[data-boneco]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        selecionado = botao.dataset.boneco;
        desenharLista();
        canvas.focus();
      });
    });
  }

  function desenharEventos(lista) {
    document.getElementById('eventos').innerHTML = lista.slice(0, 6).map(function (e) {
      return '<li><span>' + ETI.ui.hora(e.ts) + '</span>' + ETI.ui.escapar(ETI.data.descreverEvento(e)) + '</li>';
    }).join('') || '<li>Nada ainda.</li>';
  }

  let ultimaDica = '';
  function atualizarDica() {
    const b = bonecos[selecionado];
    let d;
    if (!online) d = 'Conecte o Arduino para a porta e o sensor funcionarem.';
    else if (!b) d = 'Passe um cartão no leitor para o boneco dele aparecer.';
    else if (b.uid === INTRUSO) d = 'O intruso está na sala sem ter passado cartão. Quando ele anda, o sensor de presença avisa o Arduino, que dispara o alerta.';
    else if (!naSala(b.x) && portaAberta(b.uid)) d = 'Porta aberta para ' + nome(b.uid) + '. Entre na sala para o sensor de presença ver.';
    else if (!naSala(b.x)) d = nome(b.uid) + ' está no corredor. Passe o cartão dele no leitor para abrir a porta.';
    else if (naZonaPir(b.x, b.y)) d = nome(b.uid) + ' está na sala. Andando, o sensor de presença manda movimento para o Arduino; para sair, passe o cartão de novo.';
    else d = nome(b.uid) + ' está na sala. Para sair, passe o cartão dele de novo.';
    if (d !== ultimaDica) { ultimaDica = d; document.getElementById('dica').textContent = d; }
  }

  // ---------- Cenários de teste ----------
  function mostrarCenario(txt) {
    const el = document.getElementById('cenario-msg');
    el.textContent = txt;
    el.hidden = !txt;
  }

  function atualizarBotaoIntruso() {
    const ativo = !!bonecos[INTRUSO];
    document.querySelector('#cen-intruso span').textContent = ativo ? 'Tirar o intruso' : 'Intruso na sala';
  }

  function removerIntruso() {
    if (!bonecos[INTRUSO]) return;
    delete bonecos[INTRUSO];
    ordem.splice(ordem.indexOf(INTRUSO), 1);
    if (selecionado === INTRUSO) selecionado = ordem[0] || null;
    desenharLista();
    atualizarBotaoIntruso();
  }

  function cenarioIntruso() {
    if (bonecos[INTRUSO]) {
      removerIntruso();
      mostrarCenario('');
      return;
    }
    if (!online) {
      mostrarCenario('Conecte o Arduino primeiro: é ele que decide se é intruso.');
      return;
    }
    if (st.pessoas > 0) {
      mostrarCenario('O Arduino conta ' + st.pessoas + (st.pessoas === 1 ? ' pessoa' : ' pessoas') +
        ' na sala. O intruso só é detectado com a sala vazia: use "Limpar tudo" ou passe os cartões para sair.');
      return;
    }
    const b = { uid: INTRUSO, cor: COR_INTRUSO, x: 330, y: 280, caminho: [], local: 0, remoto: null };
    bonecos[INTRUSO] = b;
    ordem.push(INTRUSO);
    selecionado = INTRUSO;
    ultimoMovEnviado = 0;
    b.caminho = RONDA_INTRUSO.map(function (p) { return { x: p.x, y: p.y }; });
    b.peloUsuario = true;
    desenharLista();
    atualizarBotaoIntruso();
    mostrarCenario('Alguém entrou sem passar cartão e está andando na sala. Aguarde o sensor de presença avisar o Arduino...');
  }

  function limparTudo() {
    const msg = 'Apagar TODOS os dados de teste?' + String.fromCharCode(10, 10) +
      'Eventos, gráfico, cartões, bonecos do mapa e a contagem de pessoas. ' +
      'As regras (limites, ar, simulada) continuam. Não dá para desfazer.';
    if (!confirm(msg)) return;
    removerIntruso();
    ETI.data.limparTudo()
      .then(function () { mostrarCenario('Dados de teste apagados.'); })
      .catch(function (e) { mostrarCenario('Erro ao limpar: ' + e.message); });
  }

  document.getElementById('cen-intruso').addEventListener('click', cenarioIntruso);
  document.getElementById('cen-limpar').addEventListener('click', limparTudo);

  if (ETI.gateway && ETI.gateway.suportado) {
    const bloco = document.getElementById('bloco-serial');
    const botao = document.getElementById('btn-serial');
    const erro = document.getElementById('erro-serial');
    bloco.hidden = false;
    botao.addEventListener('click', function () {
      if (ETI.gateway.estado().conectado) ETI.gateway.desconectar(); else ETI.gateway.conectar();
    });
    ETI.gateway.onEstado(function (s) {
      botao.querySelector('span').textContent = s.conectado ? 'Desconectar Arduino' : 'Conectar Arduino';
      botao.className = 'btn ' + (s.conectado ? 'btn-outline-primary' : 'btn-primary');
      erro.hidden = !s.erro;
      erro.textContent = s.erro || '';
      document.querySelectorAll('.topo a').forEach(function (a) {
        if (s.conectado) a.target = '_blank'; else a.removeAttribute('target');
      });
    });
  }

  const botaoFixa = document.getElementById('btn-fixa');
  const notaFixa = document.getElementById('nota-fixa');
  function atualizarLuzFixa() {
    const fixa = !!st.fixa;
    botaoFixa.disabled = !online;
    botaoFixa.className = 'btn ' + (fixa ? 'btn-primary' : 'btn-outline-primary');
    botaoFixa.querySelector('span').textContent = fixa ? 'Soltar a luz (voltar ao normal)' : 'Deixar a luz sempre acesa';
    notaFixa.hidden = !fixa;
  }
  botaoFixa.addEventListener('click', function () {
    ETI.data.enviarComando(st.fixa ? 'FIXA 0' : 'FIXA 1');
  });

  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    ETI.data.onStatus(function (s) { st = s || {}; atualizarPainelAr(); atualizarLuzFixa(); });
    ETI.data.onAlertas(function () { online = ETI.data.online(); });
    ETI.data.onConfig(function (c) { config = c; desenharLista(); atualizarPainelAr(); });
    ETI.data.onEventos(function (lista) {
      receberEventos(lista);
      if (!refBonecos) {
        refBonecos = ETI.data.raiz.child('mapa/bonecos');
        refBonecos.on('value', receberPosicoes);
      }
    });
    setInterval(function () { online = ETI.data.online(); atualizarPainelAr(); atualizarLuzFixa(); }, 1000);
  }

  ETI.auth.onUsuario(function (u) { if (u) iniciar(); });

  window.addEventListener('resize', redimensionar);
  redimensionar();
  desenharLista();
  requestAnimationFrame(quadro);
})();
