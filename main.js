/* ATIVAVID — página de vendas: só o que a página precisa, sem framework.
   Tudo aqui é melhoria: sem JavaScript a página mostra o mesmo conteúdo,
   no estado final, e todo botão funciona. */
(function () {
  var reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var temIO = 'IntersectionObserver' in window;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var quandoVisivel = function (el, fn, limiar) {
    if (!el) return;
    if (!temIO) { fn(); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { threshold: limiar || 0.4 });
    io.observe(el);
  };

  /* ---------- o corte de verdade no herói ----------
     Os cortes vêm marcados no HTML (início e duração, em segundos). Aqui o
     bruto é quebrado nos trechos que FICAM, e cada pedaço ganha --s: quanto
     foi cortado antes dele. No "corte", cada pedaço anda para a esquerda
     esse tanto e os cortes somem: os buracos se fecham como na timeline. */
  var corte = $('[data-corte]');
  var trilha = $('[data-trilha]');
  if (corte && trilha) {
    var total = 50.22;
    var cortes = $$('.tc', trilha).map(function (el) {
      return { el: el, a: parseFloat(el.style.getPropertyValue('--a')), d: parseFloat(el.style.getPropertyValue('--d')) };
    }).sort(function (x, y) { return x.a - y.a; });
    var antes = 0, cursor = 0, frag = document.createDocumentFragment();
    cortes.forEach(function (c) {
      if (c.a > cursor + 0.001) {
        var k = document.createElement('span');
        k.className = 'tk';
        k.style.cssText = '--a:' + cursor + ';--d:' + (c.a - cursor).toFixed(2) + ';--s:' + antes.toFixed(2);
        frag.appendChild(k);
      }
      c.el.style.setProperty('--s', antes.toFixed(2));
      antes += c.d;
      cursor = c.a + c.d;
    });
    if (cursor < total - 0.001) {
      var fim = document.createElement('span');
      fim.className = 'tk';
      fim.style.cssText = '--a:' + cursor + ';--d:' + (total - cursor).toFixed(2) + ';--s:' + antes.toFixed(2);
      frag.appendChild(fim);
    }
    trilha.insertBefore(frag, trilha.firstChild);
    trilha.classList.add('quebrada');

    var dur = $('[data-corte-dur]', corte);
    var aviso = $('[data-aviso]');
    var palavras = $$('.leg span', corte);
    var repetir = $('[data-corte-repetir]', corte);
    var fmt = function (n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s'; };
    var timers = [];
    var depois = function (ms, fn) { timers.push(setTimeout(fn, ms)); };

    var estadoFinal = function () {
      trilha.classList.add('cortando');
      corte.classList.add('cortado');
      if (dur) dur.textContent = fmt(total);
      palavras.forEach(function (p, i) { p.classList.toggle('on', i === 1); });
      if (aviso) aviso.classList.add('visto');
    };

    var tocar = function () {
      timers.forEach(clearTimeout); timers = [];
      trilha.classList.remove('cortando', 'marcando');
      corte.classList.remove('cortado');
      palavras.forEach(function (p) { p.classList.remove('on'); });
      if (aviso) aviso.classList.remove('visto');
      if (repetir) repetir.hidden = true;
      if (dur) dur.textContent = fmt(total);
      void trilha.offsetWidth; // reinicia a marcação; só no clique e na 1ª vez em vista
      trilha.classList.add('marcando');
      depois(1000, function () {
        trilha.classList.add('cortando');
        corte.classList.add('cortado');
      });
      depois(1900, function () {
        palavras.forEach(function (p, i) { depois(i * 300, function () { palavras.forEach(function (q) { q.classList.remove('on'); }); p.classList.add('on'); }); });
      });
      depois(2400, function () { if (aviso) aviso.classList.add('visto'); });
      depois(3300, function () { if (repetir) repetir.hidden = false; });
    };

    if (reduz) {
      estadoFinal();
    } else {
      corte.classList.add('anima');
      if (aviso) aviso.classList.add('anima-aviso');
      // começa depois da primeira pintura, quando o painel está à vista
      var comecar = function () { quandoVisivel(corte, function () { setTimeout(tocar, 350); }, 0.6); };
      if (document.readyState === 'complete') comecar(); else window.addEventListener('load', comecar, { once: true });
      if (repetir) repetir.addEventListener('click', tocar);
    }
    if (dur) dur.setAttribute('aria-hidden', 'true');
  }

  /* ---------- a régua do dia + o dock do celular ----------
     O momento que cruza o meio da tela vira o "agora": o horário fica
     vermelho, a régua marca o link e o playhead desliza até ele. */
  var regua = $('[data-regua]');
  var agora = regua && $('.regua-agora', regua);
  var momentos = $$('.momento[id]');
  var dock = $('#dock');
  var dockRot = $('#dockRot');
  var rotuloPadrao = dockRot ? dockRot.textContent : '';
  var noDia = false, atual = null;

  var marcar = function (m) {
    atual = m;
    momentos.forEach(function (x) { x.classList.toggle('agora', x === m); });
    if (regua) {
      $$('a', regua).forEach(function (a) {
        var sim = m && a.getAttribute('href') === '#' + m.id;
        if (sim) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        if (sim && agora) {
          agora.style.setProperty('--y', (a.offsetTop + (a.offsetHeight - 30) / 2) + 'px');
        }
      });
    }
    if (dockRot) dockRot.textContent = (noDia && m) ? m.getAttribute('data-rotulo') : rotuloPadrao;
  };

  if (temIO && momentos.length) {
    var ioM = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) marcar(e.target); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    momentos.forEach(function (m) { ioM.observe(m); });
    var dia = $('#dia');
    if (dia) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { noDia = e.isIntersecting; marcar(noDia ? atual : null); });
      }, { rootMargin: '-40% 0px -40% 0px' }).observe(dia);
    }
  }

  var heroi = $('.heroi');
  if (dock && heroi && temIO) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { dock.hidden = e.isIntersecting; });
    }, { threshold: 0.05 }).observe(heroi);
  }

  /* ---------- 3 x 3 x 3 = 27 e o mês de 30 vídeos ---------- */
  var grid = $('.grid27');
  if (grid) {
    for (var i = 0; i < 27; i++) {
      var s = document.createElement('span');
      s.style.animationDelay = (i * 0.04) + 's';
      grid.appendChild(s);
    }
    if (!reduz) quandoVisivel(grid, function () { grid.classList.add('estoura'); }, 0.5);
  }
  var mes = $('[data-mes]');
  if (mes) {
    $$('span', mes).forEach(function (d, n) { d.style.setProperty('--i', n); });
    if (!reduz) quandoVisivel(mes, function () { mes.classList.add('carimba'); }, 0.35);
  }

  /* ---------- Liquid Glass: brilho que segue o ponteiro + refração ---------- */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduz) {
    $$('.vidro').forEach(function (el) {
      var pendente = false, ex = 0, ey = 0;
      el.addEventListener('pointermove', function (ev) {
        ex = ev.clientX; ey = ev.clientY;
        if (pendente) return;
        pendente = true;
        requestAnimationFrame(function () {
          pendente = false;
          var r = el.getBoundingClientRect();
          el.style.setProperty('--gx', ((ex - r.left) / r.width * 100).toFixed(1) + '%');
          el.style.setProperty('--gy', ((ey - r.top) / r.height * 100).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', function () { el.style.removeProperty('--gx'); el.style.removeProperty('--gy'); });
    });
  }
  // A refração da borda usa backdrop-filter: url(#filtro), que só o
  // Chromium desenha. Nos outros a declaração não pode nem ser tentada:
  // ela anularia o desfoque e o vidro sumiria.
  var marcas = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  var chromium = marcas.some(function (b) { return /Chromium/.test(b.brand); });
  var semTransp = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  if (chromium && !semTransp && window.CSS && CSS.supports('backdrop-filter', 'url(#a) blur(1px)')) {
    $$('.refrata-alvo').forEach(function (el) { el.classList.add('refrata'); });
  }

  /* ---------- Mac: só promete o download quando o .dmg existe ----------
     O HTML nasce em "Me avise" (o formulário guarda o lead com sistema=mac).
     Só quando /download/info confirma um .dmg publicado o botão vira
     "Baixar para Mac". Se a consulta falhar, fica o aviso: nunca prometer
     um download que não existe. */
  var botaoMac = $('[data-mac-botao]');
  if (botaoMac && window.fetch) {
    fetch('/download/info', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.mac) return;
        botaoMac.textContent = 'Baixar para Mac';
        botaoMac.setAttribute('data-ativa-params', 'sistema=mac');
        var nota = $('[data-mac-nota]');
        if (nota) nota.textContent = '';
      })
      .catch(function () {});
  }

  /* ---------- ano do rodapé ---------- */
  var ano = $('#ano');
  if (ano) ano.textContent = String(new Date().getFullYear());

  /* ---------- dúvidas: um aberto por vez ---------- */
  $$('.acc details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) $$('.acc details').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
})();

/* --- 18h, a conta: vídeos/mês x preço por edição --- */
(function () {
  var v = document.getElementById('calcVideos');
  var p = document.getElementById('calcPreco');
  if (!v || !p) return;
  var ASSINATURA = 59;
  var brl = function (n, cents) { return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }); };
  var el = function (id) { return document.getElementById(id); };
  var presets = Array.prototype.slice.call(document.querySelectorAll('.calc-presets button'));
  var faixas = Array.prototype.slice.call(document.querySelectorAll('.faixa'));
  var render = function (piscar) {
    var videos = Number(v.value);
    var preco = Number(p.value);
    faixas.forEach(function (f) {
      var mn = Number(f.dataset.min), mx = Number(f.dataset.max);
      var on = preco >= mn && preco < mx;
      f.classList.toggle('on', on);
      f.setAttribute('aria-pressed', on ? 'true' : 'false');
      var t = f.querySelector('[data-total]');
      if (t) t.textContent = brl(Number(f.dataset.preco) * videos) + ' /mês com ' + videos + ' vídeos';
    });
    var fora = videos * preco;
    el('calcVideosOut').textContent = String(videos);
    el('calcPrecoOut').textContent = brl(preco);
    el('calcFora').textContent = brl(fora);
    el('calcForaAno').textContent = brl(fora * 12) + ' por ano';
    el('calcPorVideo').textContent = brl(ASSINATURA / videos, true) + ' por vídeo';
    var sobra = Math.max(0, fora - ASSINATURA);
    el('calcSobra').innerHTML = brl(sobra) + ' <span>/mês</span>';
    var vezes = fora / ASSINATURA;
    el('calcVezes').textContent = vezes >= 2
      ? Math.round(vezes).toLocaleString('pt-BR') + ' vezes o valor da assinatura'
      : 'já compensa a partir do primeiro vídeo';
    presets.forEach(function (b) {
      var on = Number(b.dataset.v) === videos;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // os números piscam quando MUDAM. Na primeira pintura não: o `offsetWidth`
    // que reinicia a animação forçaria um layout da página inteira ainda no
    // carregamento (era uma tarefa longa de ~740 ms no celular).
    if (!piscar) return;
    ['calcFora', 'calcSobra', 'calcPorVideo'].forEach(function (id) {
      var n = el(id); if (!n) return;
      n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
    });
  };
  v.addEventListener('input', function () { render(true); });
  p.addEventListener('input', function () { render(true); });
  presets.forEach(function (b) { b.addEventListener('click', function () { v.value = b.dataset.v; render(true); }); });
  faixas.forEach(function (f) {
    f.addEventListener('click', function () {
      p.value = f.dataset.preco;
      render(true);
      var calc = document.getElementById('calc');
      if (calc && window.matchMedia('(max-width: 960px)').matches) calc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  render();
})();

/* O feixe dos CTAs para quando a aba não está à frente. O navegador já
   congela animação de aba ESCONDIDA, mas não de aba visível e sem foco.
   `blur` só vale depois que um `focus` chegou pelo menos uma vez: sem essa
   prova o feixe poderia nascer parado e nunca girar. */
(function () {
  var raiz = document.documentElement;
  var focoFunciona = document.hasFocus && document.hasFocus();
  function aplicar() {
    var olhando = !document.hidden && (!focoFunciona || document.hasFocus());
    raiz.classList.toggle('janela-parada', !olhando);
  }
  document.addEventListener('visibilitychange', aplicar);
  window.addEventListener('focus', function () { focoFunciona = true; aplicar(); });
  window.addEventListener('blur', aplicar);
  aplicar();
})();
