/* ATIVAVID — página de vendas: só o que a página precisa, sem framework. */
(function () {
  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- revelar ao rolar (seções e cards) --- */
  const alvos = document.querySelectorAll('.step, .feat, .who-card, .plan, .stat, .sec-head, .guarantee, .combo');
  alvos.forEach((el) => el.classList.add('reveal'));
  if ('IntersectionObserver' in window && !reduz) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    alvos.forEach((el) => io.observe(el));
  } else {
    alvos.forEach((el) => el.classList.add('in'));
  }

  /* --- contadores (270, 27) --- */
  const contar = (el) => {
    const fim = Number(el.dataset.count || 0);
    if (!fim || reduz) { el.textContent = String(fim); return; }
    const t0 = performance.now(); const dur = 1100;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(fim * e));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const cts = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { contar(e.target); io2.unobserve(e.target); } });
    }, { threshold: 0.6 });
    cts.forEach((el) => io2.observe(el));
  } else { cts.forEach(contar); }

  /* --- 3 x 3 x 3 = 27 --- */
  const grid = document.querySelector('.grid27');
  if (grid) {
    for (let i = 0; i < 27; i++) {
      const s = document.createElement('span');
      s.style.animationDelay = `${0.6 + i * 0.05}s`;
      grid.appendChild(s);
    }
  }

  /* --- barra fixa de CTA no celular, depois do herói --- */
  const sticky = document.getElementById('stickyCta');
  const hero = document.querySelector('.hero');
  if (sticky && hero && 'IntersectionObserver' in window) {
    const io3 = new IntersectionObserver((entries) => {
      entries.forEach((e) => { sticky.hidden = e.isIntersecting; });
    }, { threshold: 0.1 });
    io3.observe(hero);
  }

  /* --- ano do rodapé --- */
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = String(new Date().getFullYear());

  /* --- FAQ: um aberto por vez --- */
  document.querySelectorAll('.acc details').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) document.querySelectorAll('.acc details').forEach((o) => { if (o !== d) o.open = false; });
    });
  });
})();

/* --- Faça a conta: vídeos/mês x preço por edição --- */
(function () {
  const v = document.getElementById('calcVideos');
  const p = document.getElementById('calcPreco');
  if (!v || !p) return;
  const ASSINATURA = 59;
  const brl = (n, cents) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const el = (id) => document.getElementById(id);
  const presets = Array.from(document.querySelectorAll('.calc-presets button'));
  const faixas = Array.from(document.querySelectorAll('.faixa'));
  const render = () => {
    const videos = Number(v.value);
    const preco = Number(p.value);
    // a faixa acesa e a que contem o preco escolhido
    faixas.forEach((f) => {
      const mn = Number(f.dataset.min), mx = Number(f.dataset.max);
      f.classList.toggle('on', preco >= mn && preco < mx);
      // o total de CADA faixa, ao vivo, para a escolha responder na hora
      const t = f.querySelector('[data-total]');
      if (t) t.textContent = brl(Number(f.dataset.preco) * videos) + ' /mês com ' + videos + ' vídeos';
    });
    const fora = videos * preco;
    el('calcVideosOut').textContent = String(videos);
    el('calcPrecoOut').textContent = brl(preco);
    el('calcFora').textContent = brl(fora);
    el('calcForaAno').textContent = brl(fora * 12) + ' por ano';
    el('calcPorVideo').textContent = brl(ASSINATURA / videos, true) + ' por vídeo';
    const sobra = Math.max(0, fora - ASSINATURA);
    el('calcSobra').innerHTML = brl(sobra) + ' <span>/mês</span>';
    const vezes = fora / ASSINATURA;
    el('calcVezes').textContent = vezes >= 2
      ? Math.round(vezes).toLocaleString('pt-BR') + ' vezes o valor da assinatura'
      : 'já compensa a partir do primeiro vídeo';
    presets.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === videos));
    // os numeros piscam quando mudam
    ['calcFora', 'calcSobra', 'calcPorVideo'].forEach((id) => {
      const n = el(id); if (!n) return;
      n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
    });
  };
  v.addEventListener('input', render);
  p.addEventListener('input', render);
  presets.forEach((b) => b.addEventListener('click', () => { v.value = b.dataset.v; render(); }));
  faixas.forEach((f) => f.addEventListener('click', () => {
    p.value = f.dataset.preco;
    render();
    const calc = document.getElementById('calc');
    if (calc && window.matchMedia('(max-width: 960px)').matches) calc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  render();
})();
