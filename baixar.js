/* ATIVAVID — /baixar: reconhece o sistema e oferece o instalador certo.
   Sem JavaScript a página já funciona: o botão principal é o do Windows e os
   três cartões levam a /download/windows, /download/mac e /download/mac-intel. */
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
  var alt = el('dlAlt');
  var altLink = el('dlAltLink');

  var avisar = function (t) { aviso.textContent = t; aviso.hidden = false; };

  var tamanho = function (b) {
    if (!b) return '';
    var gb = b / 1073741824;
    if (gb >= 0.95) return gb.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' GB';
    return Math.max(1, Math.round(b / 1048576)) + ' MB';
  };

  /* Mac: o botão principal é do chip que o navegador revelou. Sem certeza
     (o Safari esconde a placa), vai o do chip Apple, que é o Mac vendido
     desde 2020, e o link logo abaixo oferece o outro. */
  var macIntel = false;
  var info = null;
  function oferecerMac() {
    var chave = macIntel ? 'macIntel' : 'mac';
    var nome = macIntel ? 'Mac com processador Intel' : 'Mac com chip Apple';
    var pub = info ? info[chave] : undefined;
    main.dataset.sistema = macIntel ? 'mac-intel' : 'mac';
    detectado.textContent = 'Reconhecemos um Mac. Este é o instalador para você: 7 dias grátis, sem cartão.';
    if (info && !pub) {
      botao.removeAttribute('href');
      botao.setAttribute('aria-disabled', 'true');
      texto.textContent = macIntel ? 'Em breve para Mac Intel' : 'Em breve para Mac';
      detalhe.textContent = 'O instalador do ' + nome + ' sai nos próximos dias. Siga @ativavid para saber primeiro.';
    } else {
      botao.href = macIntel ? '/download/mac-intel' : '/download/mac';
      botao.removeAttribute('aria-disabled');
      botao.dataset.cta = macIntel ? 'baixar-principal-mac-intel' : 'baixar-principal-mac';
      texto.textContent = macIntel ? 'Baixar para Mac Intel' : 'Baixar para Mac';
      detalhe.textContent = nome + ' · macOS 12 ou mais novo' + (pub ? ' · ' + tamanho(pub.tamanho) : '');
    }
    var outro = info ? info[macIntel ? 'mac' : 'macIntel'] : true;
    alt.hidden = !outro;
    altLink.href = macIntel ? '/download/mac' : '/download/mac-intel';
    altLink.dataset.cta = macIntel ? 'baixar-alt-mac' : 'baixar-alt-mac-intel';
    altLink.textContent = macIntel
      ? 'Seu Mac tem chip Apple (M1 ou mais novo)? Baixe a versão para chip Apple'
      : 'Seu Mac tem processador Intel? Baixe a versão para Mac Intel';
  }

  if (mac) {
    oferecerMac();
    // Chip Apple ou Intel? O User-Agent não diz (todo Mac se diz "Intel").
    // O Chrome responde pela API de dicas; nos outros, o nome da placa no
    // WebGL costuma trazer "Apple M1" ou "Intel".
    var ehIntel = function () { macIntel = true; oferecerMac(); };
    if (uad && uad.getHighEntropyValues) {
      uad.getHighEntropyValues(['architecture']).then(function (v) {
        if (v && v.architecture === 'x86') ehIntel();
      }).catch(function () {});
    } else {
      try {
        var gl = document.createElement('canvas').getContext('webgl');
        var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        var placa = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        if (/Intel|AMD|Radeon/i.test(placa) && !/Apple M/i.test(placa)) ehIntel();
      } catch (e) { /* sem WebGL: sem palpite */ }
    }
  } else if (windows) {
    detectado.textContent = 'Reconhecemos um Windows. Este é o instalador para você: 7 dias grátis, sem cartão.';
  } else if (celular) {
    main.hidden = true;
    detectado.textContent = 'O ATIVAVID é um programa para computador.';
    avisar('Abra ativavid.com/baixar no seu Windows ou Mac para instalar. Os instaladores estão logo abaixo, se quiser baixar mesmo assim.');
  } else if (linux) {
    detectado.textContent = 'O ATIVAVID ainda não tem versão para Linux.';
    avisar('Ele roda em Windows 10/11 e em Mac (chip Apple ou Intel).');
  }

  /* Versão e tamanho reais de cada instalador. O que ainda não foi
     publicado diz isso no cartão em vez de levar a um erro. */
  var cartoes = [
    { chave: 'mac', card: 'cardMac', breve: 'Em breve para Mac' },
    { chave: 'macIntel', card: 'cardMacIntel', breve: 'Em breve para Mac Intel' }
  ];
  fetch('/download/info', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      info = d;
      var w = document.querySelector('[data-meta="windows"]');
      if (d.windows && w) {
        w.textContent = 'Versão ' + d.windows.versao + ' · ' + tamanho(d.windows.tamanho);
        if (!mac) detalhe.textContent = 'Windows 10/11 · 64 bits · ' + tamanho(d.windows.tamanho);
      }
      cartoes.forEach(function (c) {
        var meta = document.querySelector('[data-meta="' + c.chave + '"]');
        if (!meta) return;
        if (d[c.chave]) {
          meta.textContent = 'Versão ' + d[c.chave].versao + ' · ' + tamanho(d[c.chave].tamanho);
        } else {
          meta.textContent = 'Este instalador sai nos próximos dias.';
          var b = document.querySelector('#' + c.card + ' .plat-btn');
          if (b) { b.removeAttribute('href'); b.setAttribute('aria-disabled', 'true'); (b.querySelector('span') || b).textContent = c.breve; }
        }
      });
      if (mac) oferecerMac();
    })
    .catch(function () {});

  var ano = el('ano');
  if (ano) ano.textContent = String(new Date().getFullYear());
})();
