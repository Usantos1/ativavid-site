/* ATIVAVID — /baixar: reconhece o sistema e oferece o instalador certo.
   Sem JavaScript a página já funciona: o botão principal é o do Windows e os
   dois cartões levam a /download/windows e /download/mac. */
(function () {
  var ua = navigator.userAgent || '';
  var uad = navigator.userAgentData;
  var plataforma = (uad && uad.platform) || '';

  // iPad com iPadOS se apresenta como Mac: o toque o denuncia.
  var toque = navigator.maxTouchPoints > 1;
  var celular = /Android|iPhone|iPod/i.test(ua) || (uad && uad.mobile) || (/Macintosh/.test(ua) && toque);
  var mac = !celular && (/mac/i.test(plataforma) || /Macintosh|Mac OS X/.test(ua));
  var windows = !celular && !mac && (/win/i.test(plataforma) || /Windows/.test(ua));
  var linux = !celular && !mac && !windows && /Linux|CrOS/i.test(ua);

  var el = function (id) { return document.getElementById(id); };
  var detectado = el('dlDetectado');
  var main = el('dlMain');
  var botao = el('dlBotao');
  var texto = el('dlBotaoTexto');
  var detalhe = el('dlDetalhe');
  var aviso = el('dlAviso');

  var avisar = function (t) { aviso.textContent = t; aviso.hidden = false; };

  function oferecerMac() {
    main.dataset.sistema = 'mac';
    botao.href = '/download/mac';
    botao.dataset.cta = 'baixar-principal-mac';
    texto.textContent = 'Baixar para Mac';
    detalhe.textContent = 'Mac com chip Apple · macOS 12 ou mais novo';
    detectado.textContent = 'Reconhecemos um Mac. Este é o instalador para você: 7 dias grátis, sem cartão.';
    el('passosWindows').open = false;
  }

  if (mac) {
    oferecerMac();
    // Chip Apple ou Intel? O navegador não diz no User-Agent (todo Mac se
    // diz "Intel"). O Chrome responde pela API de dicas; nos outros, o nome
    // da placa no WebGL costuma trazer "Apple M1"/"Intel". Sem certeza,
    // nada é dito: o requisito está escrito no botão.
    var intel = function () {
      avisar('Este Mac parece ter processador Intel. Por enquanto o ATIVAVID roda só em Mac com chip Apple (M1 ou mais novo).');
    };
    if (uad && uad.getHighEntropyValues) {
      uad.getHighEntropyValues(['architecture']).then(function (v) {
        if (v && v.architecture === 'x86') intel();
      }).catch(function () {});
    } else {
      try {
        var gl = document.createElement('canvas').getContext('webgl');
        var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        var placa = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        if (/Intel|AMD|Radeon/i.test(placa) && !/Apple M/i.test(placa)) intel();
      } catch (e) { /* sem WebGL: sem palpite */ }
    }
  } else if (windows) {
    detectado.textContent = 'Reconhecemos um Windows. Este é o instalador para você: 7 dias grátis, sem cartão.';
    el('passosMac').open = false;
  } else if (celular) {
    main.hidden = true;
    detectado.textContent = 'O ATIVAVID é um programa para computador.';
    avisar('Abra ativavid.com/baixar no seu Windows ou Mac para instalar. Os dois instaladores estão logo abaixo, se quiser baixar mesmo assim.');
  } else if (linux) {
    detectado.textContent = 'O ATIVAVID ainda não tem versão para Linux.';
    avisar('Ele roda em Windows 10/11 e em Mac com chip Apple.');
  }

  /* Versão e tamanho reais de cada instalador. Se o do Mac ainda não foi
     publicado, o cartão diz isso em vez de levar a um erro. */
  var tamanho = function (b) {
    if (!b) return '';
    var gb = b / 1073741824;
    if (gb >= 0.95) return gb.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' GB';
    return Math.max(1, Math.round(b / 1048576)) + ' MB';
  };
  fetch('/download/info', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var w = document.querySelector('[data-meta="windows"]');
      var m = document.querySelector('[data-meta="mac"]');
      if (d.windows && w) {
        w.textContent = 'Versão ' + d.windows.versao + ' · ' + tamanho(d.windows.tamanho);
        if (!mac) detalhe.textContent = 'Windows 10/11 · 64 bits · ' + tamanho(d.windows.tamanho);
      }
      if (m) {
        if (d.mac) {
          m.textContent = 'Versão ' + d.mac.versao + ' · ' + tamanho(d.mac.tamanho);
          if (mac) detalhe.textContent = 'Mac com chip Apple · macOS 12+ · ' + tamanho(d.mac.tamanho);
        } else {
          m.textContent = 'O instalador do Mac sai nos próximos dias.';
          var b = document.querySelector('#cardMac .plat-btn');
          if (b) { b.removeAttribute('href'); b.setAttribute('aria-disabled', 'true'); b.textContent = 'Em breve para Mac'; }
          if (mac) {
            botao.removeAttribute('href');
            botao.setAttribute('aria-disabled', 'true');
            texto.textContent = 'Em breve para Mac';
            detalhe.textContent = 'O instalador do Mac sai nos próximos dias. Siga @ativavid para saber primeiro.';
          }
        }
      }
    })
    .catch(function () {});

  var ano = el('ano');
  if (ano) ano.textContent = String(new Date().getFullYear());
})();
