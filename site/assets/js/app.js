window.ETI = window.ETI || {};

(function () {
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const DIAS_CURTO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const PAGINAS = [
    { href: 'dashboard.html', nome: 'Sala', icone: 'bi-door-open' },
    { href: 'mapa.html', nome: 'Mapa', icone: 'bi-map' },
    { href: 'energia.html', nome: 'Energia', icone: 'bi-lightning-charge' },
    { href: 'avisos.html', nome: 'Avisos', icone: 'bi-megaphone', soGestor: true },
    { href: 'relatorio.html', nome: 'Relatório', icone: 'bi-file-earmark-text', soGestor: true },
    { href: 'painel.html', nome: 'Painel', icone: 'bi-tv' }
  ];

  ETI.ui = {
    dias: DIAS_CURTO,

    sessao: function () {
      // Gravada pela tela de login depois que o Firebase confere e-mail, senha e perfil da conta.
      try { return JSON.parse(localStorage.getItem('eti:sessao') || 'null'); }
      catch (e) { return null; }
    },

    exigirSessao: function (soGestor) {
      const s = ETI.ui.sessao();
      if (!s) { location.replace('index.html'); return null; }
      if (soGestor && s.perfil !== 'gestor') { location.replace('dashboard.html'); return null; }
      return s;
    },

    montarTopo: function (atual) {
      const alvo = document.querySelector('[data-menu]');
      if (!alvo) return;
      const perfil = (ETI.ui.sessao() || {}).perfil || 'gestor';

      let html = '';
      PAGINAS.forEach(function (p) {
        if (p.soGestor && perfil !== 'gestor') return;
        html += '<a href="' + p.href + '"' +
          (p.href === atual ? ' aria-current="page"' : '') + '>' +
          '<i class="bi ' + p.icone + '" aria-hidden="true"></i>' + p.nome + '</a>';
      });
      html += '<button type="button" data-sair><i class="bi bi-box-arrow-right" aria-hidden="true"></i>Sair</button>';

      alvo.innerHTML = html;
      alvo.querySelector('[data-sair]').addEventListener('click', function () {
        localStorage.removeItem('eti:sessao');
        if (ETI.auth) ETI.auth.sair();
        else location.href = 'index.html';
      });
    },

    relogio: function (seletorHora, seletorData) {
      const elHora = document.querySelector(seletorHora);
      const elData = seletorData ? document.querySelector(seletorData) : null;
      function tick() {
        const d = new Date();
        if (elHora) {
          elHora.textContent = String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
        }
        if (elData) {
          elData.textContent = DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()];
        }
      }
      tick();
      setInterval(tick, 1000);
    },

    moeda: function (v) {
      return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    numero: function (v, casas) {
      return (v || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: casas || 0,
        maximumFractionDigits: casas || 0
      });
    },

    dataHora: function (ts) {
      const d = new Date(ts);
      return String(d.getDate()).padStart(2, '0') + '/' +
        String(d.getMonth() + 1).padStart(2, '0') + ', ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    },

    hora: function (ts) {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },

    dataExtenso: function (ts) {
      const d = new Date(ts || Date.now());
      return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
    },

    escapar: function (txt) {
      const d = document.createElement('div');
      d.textContent = txt == null ? '' : String(txt);
      return d.innerHTML;
    },

    prazo: function (meses) {
      if (!isFinite(meses) || meses <= 0) return null;
      const anos = Math.floor(meses / 12);
      const resto = Math.round(meses % 12);
      if (anos === 0) return Math.max(1, Math.round(meses)) + ' meses';
      return anos + (anos === 1 ? ' ano' : ' anos') + (resto ? ' e ' + resto + ' meses' : '');
    },

    baixarCsv: function (nome, linhas) {
      const texto = linhas.map(function (l) {
        return l.map(function (c) {
          const s = String(c == null ? '' : c);
          return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(';');
      }).join('\n');
      const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    chartBase: function () {
      const eixo = {
        grid: { display: false },
        border: { color: '#DFE7F5' },
        ticks: {
          color: '#5A6C9C',
          font: { family: 'Inter, system-ui, sans-serif', size: 11 },
          padding: 8,
          maxRotation: 0,
          autoSkipPadding: 24
        }
      };
      return {
        eixoX: eixo,
        eixoY: Object.assign({}, eixo, {
          grid: { color: '#EEF2FA', drawTicks: false },
          border: { display: false }
        }),
        opcoes: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#07296F',
              titleFont: { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' },
              bodyFont: { family: 'Inter, system-ui, sans-serif', size: 12 },
              cornerRadius: 8,
              padding: 10,
              displayColors: false
            }
          }
        }
      };
    }
  };
})();
