/* Área do aluno — ATIVAVID (versão web).
 *
 * Quem decide o que o aluno vê é o Postgres, não esta página:
 *   ativavid_area_aluno()        aulas, assinatura e uso de quem entrou
 *   ativavid_aula_marcar(...)    marca uma aula como assistida
 * As duas usam o login (auth.jwt()). Nada aqui chega a outra conta.
 *
 * Mesma base visual e de comportamento do painel admin (admin.js).
 */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";
  const DIA = 86400000;

  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
  // Dentro do painel admin (Academy) a página não tem menu nem botão Sair:
  // quem dá isso é o próprio admin.
  const embutido = new URLSearchParams(location.search).has("painel");

  const SECOES = {
    inicio: { titulo: "Início", sub: "Sua assinatura e o seu uso do ATIVAVID." },
    aulas: { titulo: "Aulas", sub: "Assista às aulas e marque as que já viu." },
    conta: { titulo: "Conta", sub: "Seu acesso ao ATIVAVID." },
  };

  const estado = { dados: null, emailTroca: "", aulaAberta: null };

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = String(txt);
    return n;
  };
  const ms = (iso) => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const dia = (iso) => {
    const t = ms(iso);
    if (!t) return "—";
    return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };
  const fmtNum = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const iniciais = (texto) => {
    const base = String(texto || "?").split("@")[0].replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    const p = base.split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] || p[0] || "")[0]).toUpperCase();
  };

  /* ---------- avisos ---------- */

  function recado(msg, tom) {
    const r = $("recado");
    if (!msg) { r.hidden = true; return; }
    r.textContent = msg;
    r.dataset.tom = tom || "ok";
    r.hidden = false;
    clearTimeout(recado._t);
    recado._t = setTimeout(() => { r.hidden = true; }, 6500);
  }

  function avisarEntrar(id, msg, tom) {
    const e = $(id);
    if (!msg) { e.hidden = true; return; }
    e.textContent = msg;
    e.dataset.tom = tom || "erro";
    e.hidden = false;
  }

  async function ocupado(bt, tarefa, onde) {
    if (!bt || bt.disabled) return;
    const antes = bt.textContent;
    bt.disabled = true;
    bt.setAttribute("aria-busy", "true");
    bt.textContent = "…";
    try {
      await tarefa();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (onde) avisarEntrar(onde, msg); else recado(msg, "erro");
    } finally {
      bt.disabled = false;
      bt.removeAttribute("aria-busy");
      bt.textContent = antes;
    }
  }

  /* ---------- modal ---------- */

  function abrirModal(titulo, corpo) {
    $("modalTitulo").textContent = titulo;
    const alvo = $("modalCorpo");
    alvo.innerHTML = "";
    alvo.appendChild(corpo);
    $("modal").hidden = false;
    document.body.classList.add("adm-travado");
  }

  function fecharModal() {
    $("modal").hidden = true;
    $("modalCorpo").innerHTML = ""; // tira o iframe do vídeo, que para o som
    document.body.classList.remove("adm-travado");
  }

  /* ---------- preferências (as mesmas do admin) ---------- */

  function aplicarTema(tema) {
    if (tema) document.body.dataset.tema = tema; else delete document.body.dataset.tema;
  }

  function temaEfetivo() {
    if (document.body.dataset.tema) return document.body.dataset.tema;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "escuro";
  }

  function alternarTema() {
    const novo = temaEfetivo() === "claro" ? "escuro" : "claro";
    aplicarTema(novo);
    $("btTema").setAttribute("aria-label", novo === "claro" ? "Usar tema escuro" : "Usar tema claro");
    try { localStorage.setItem("adm-tema", novo); } catch { /* sem armazenamento */ }
  }

  function aplicarMenu(aberto) {
    $("painel").classList.toggle("adm-app--fechado", !aberto);
    $("btMenu").setAttribute("aria-expanded", aberto ? "true" : "false");
    $("btMenu").dataset.tip = aberto ? "Recolher menu" : "Expandir menu";
    try { localStorage.setItem("adm-menu", aberto ? "aberto" : "fechado"); } catch { /* sem armazenamento */ }
  }

  function lerPreferencias() {
    let tema = null;
    let menu = "aberto";
    try {
      tema = localStorage.getItem("adm-tema");
      menu = localStorage.getItem("adm-menu") || "aberto";
    } catch { /* sem armazenamento */ }
    aplicarTema(tema === "claro" || tema === "escuro" ? tema : null);
    aplicarMenu(menu !== "fechado");
  }

  function fecharMenus() {
    $("menuPerfil").hidden = true;
    $("btPerfil").setAttribute("aria-expanded", "false");
  }

  /* ---------- entrar ---------- */

  function situacaoAssinatura(a) {
    if (!a) return { rot: "Sem assinatura", tom: "neutro", sub: "Esta conta ainda não tem assinatura ativa." };
    const ate = dia(a.validaAte);
    if (a.status !== "active" || a.diasRestantes < 0) return { rot: "Vencida", tom: "mal", sub: `Venceu em ${ate}.` };
    if (a.diasRestantes <= 30) {
      const d = a.diasRestantes;
      return { rot: `Vence em ${d} dia${d === 1 ? "" : "s"}`, tom: "atencao", sub: `Válida até ${ate}.` };
    }
    return { rot: "Ativa", tom: "ok", sub: `Válida até ${ate} · ${a.diasRestantes} dias restantes.` };
  }

  async function carregar() {
    const { data, error } = await sb.rpc("ativavid_area_aluno");
    if (!error && data && data.ok) {
      estado.dados = data;
      return true;
    }
    if (data && data.error === "login") return false;
    throw new Error("Não consegui carregar os seus dados. Atualize a página.");
  }

  async function abrirArea() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrarEntrada();
    let ok;
    try {
      ok = await carregar();
    } catch (e) {
      recado(e.message, "erro");
      ok = true;
    }
    if (!ok) {
      await sb.auth.signOut();
      return mostrarEntrada();
    }
    $("telaEntrar").hidden = true;
    $("painel").hidden = false;
    $("btSair").hidden = embutido;
    $("senha").value = "";
    desenharPerfil();
    desenharInicio();
    desenharAulas();
    desenharConta();
    rotear();
  }

  function mostrarEntrada() {
    $("painel").hidden = true;
    $("telaEntrar").hidden = false;
    mostrarTrocar(false);
  }

  async function entrar(ev) {
    ev.preventDefault();
    avisarEntrar("erroEntrar", "");
    const email = $("email").value.trim().toLowerCase();
    await ocupado($("btEntrar"), async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password: $("senha").value });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invalid")) throw new Error("E-mail ou senha errados.");
        if (m.includes("confirm")) throw new Error("Este e-mail ainda não foi confirmado.");
        throw new Error(error.message || "Não consegui entrar.");
      }
      await abrirArea();
    }, "erroEntrar");
  }

  function mostrarTrocar(mostrar) {
    $("formEntrar").hidden = mostrar;
    $("formTrocar").hidden = !mostrar;
    $("passoPedir").hidden = false;
    $("passoCodigo").hidden = true;
    avisarEntrar("avisoTrocar", "");
    if (mostrar) $("emailTrocar").value = $("email").value.trim().toLowerCase();
  }

  function pedirCodigo(bt) {
    const email = $("emailTrocar").value.trim().toLowerCase();
    if (!email.includes("@")) return avisarEntrar("avisoTrocar", "Informe o e-mail da sua conta.");
    return ocupado(bt, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) throw new Error(error.message || "Não consegui mandar o código.");
      estado.emailTroca = email;
      $("passoPedir").hidden = true;
      $("passoCodigo").hidden = false;
      avisarEntrar("avisoTrocar", `Se existir conta com ${email}, o código chega em instantes. Olhe também o spam.`, "ok");
      $("codigo").focus();
    }, "avisoTrocar");
  }

  function trocarSenha(bt) {
    const codigo = $("codigo").value.replace(/\D/g, "");
    const senha = $("senhaNova").value;
    if (codigo.length < 4) return avisarEntrar("avisoTrocar", "Digite o código que chegou no e-mail.");
    if (senha.length < 6) return avisarEntrar("avisoTrocar", "A senha nova precisa de pelo menos 6 caracteres.");
    return ocupado(bt, async () => {
      const { error: e1 } = await sb.auth.verifyOtp({ email: estado.emailTroca, token: codigo, type: "recovery" });
      if (e1) {
        const m = (e1.message || "").toLowerCase();
        if (m.includes("expired")) throw new Error("O código venceu. Peça um novo.");
        throw new Error("Código errado ou vencido. Peça um código novo.");
      }
      const { error: e2 } = await sb.auth.updateUser({ password: senha });
      if (e2) throw new Error(e2.message || "Não consegui trocar a senha.");
      await abrirArea();
    }, "avisoTrocar");
  }

  async function sair() {
    await sb.auth.signOut();
    location.reload();
  }

  /* ---------- perfil ---------- */

  function desenharPerfil() {
    const email = estado.dados.email || "";
    const nome = email.split("@")[0] || "Aluno";
    for (const id of ["avatarUsuario", "avatarMenu"]) $(id).textContent = iniciais(nome);
    $("saudacao").textContent = `Olá, ${nome}`;
    $("nomeMenu").textContent = nome;
    $("quem").textContent = email;
  }

  /* ---------- início ---------- */

  function desenharInicio() {
    const d = estado.dados;
    const a = d.assinatura;
    const s = situacaoAssinatura(a);
    const v = d.videos || {};
    const aulas = d.aulas || [];
    const feitas = (d.progresso || []).filter((p) => p.concluida).length;

    const kp = $("kpis");
    kp.innerHTML = "";
    const itens = [
      ["Assinatura", s.rot, s.tom, a ? `${a.computadores} computador${a.computadores === 1 ? "" : "es"} liberado${a.computadores === 1 ? "" : "s"}` : "sem assinatura ativa"],
      ["Vídeos editados", v.total || 0, "neutro", "desde o começo"],
      ["Neste mês", v.mes || 0, "neutro", "vídeos editados"],
      ["Vídeo entregue", `${fmtNum(v.minutosEntregues)} min`, "neutro", "tempo de vídeo pronto"],
      ["Gravação usada", `${fmtNum(v.minutosDeFonte)} min`, "neutro", "material bruto editado"],
      ["Aulas assistidas", `${feitas} de ${aulas.length}`, feitas && feitas === aulas.length ? "ok" : "neutro", "marcadas por você"],
    ];
    for (const [rot, n, tom, sub] of itens) {
      const k = el("div", `adm-vidro adm-kpi adm-kpi-${tom}`);
      k.append(el("span", "adm-kpi-rot", rot), el("strong", "adm-kpi-n", n), el("span", "adm-kpi-sub", sub));
      kp.append(k);
    }

    const box = $("assinatura");
    box.innerHTML = "";
    box.append(el("span", `adm-chip adm-chip-${s.tom}`, s.rot), el("p", "adm-ajuda aulas-linha", s.sub));
    if (!a) box.append(el("p", "adm-ajuda aulas-linha", "Para assinar, use o link que você recebeu ou fale com o suporte."));
  }

  /* ---------- aulas ---------- */

  function progressoDe(aulaId) {
    return (estado.dados.progresso || []).some((p) => p.aulaId === aulaId && p.concluida);
  }

  function desenharAulas() {
    const aulas = estado.dados.aulas || [];
    const feitas = aulas.filter((a) => progressoDe(a.id)).length;
    $("resumoAulas").textContent = aulas.length
      ? `${feitas} de ${aulas.length} assistidas`
      : "Ainda não há aulas publicadas.";

    const lista = $("listaAulas");
    lista.innerHTML = "";
    const grupos = new Map();
    for (const a of aulas) {
      if (!grupos.has(a.secao)) grupos.set(a.secao, []);
      grupos.get(a.secao).push(a);
    }
    for (const [secao, itens] of grupos) {
      lista.append(el("h3", "adm-aluno-secao", secao));
      const grade = el("div", "adm-aluno-grade");
      for (const a of itens) grade.append(cartaoAula(a));
      lista.append(grade);
    }
  }

  function cartaoAula(a) {
    const feita = progressoDe(a.id);
    const card = el("article", "adm-vidro adm-aluno-card");
    const capa = el("div", "adm-aluno-capa");
    const img = document.createElement("img");
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(a.youtubeId)}/mqdefault.jpg`;
    img.alt = "";
    img.loading = "lazy";
    capa.appendChild(img);
    const corpo = el("div", "adm-aluno-corpo");
    const topo = el("div", "aulas-topo");
    topo.append(el("h4", "", a.titulo || "Aula"), el("span", `adm-chip adm-chip-${feita ? "ok" : "espera"}`, feita ? "Assistida" : "Não assistida"));
    corpo.append(topo);
    if (a.descricao) corpo.append(el("p", "", a.descricao));
    const bt = el("button", "adm-bt adm-bt-forte adm-bt-sm adm-aluno-assistir", feita ? "Rever" : "Assistir");
    bt.type = "button";
    bt.addEventListener("click", () => abrirAula(a));
    corpo.append(bt);
    card.append(capa, corpo);
    return card;
  }

  function abrirAula(a) {
    estado.aulaAberta = a;
    const corpo = el("div", "aulas-janela");
    const video = el("div", "aulas-video");
    const frame = document.createElement("iframe");
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtubeId)}?rel=0`;
    frame.title = a.titulo || "Aula";
    frame.allow = "accelerometer; encrypted-media; picture-in-picture";
    frame.allowFullscreen = true;
    video.appendChild(frame);
    const bt = el("button", "adm-bt adm-bt-forte adm-bt-cheio", "");
    bt.type = "button";
    bt.id = "btConcluir";
    bt.addEventListener("click", () => marcarAula(bt, a));
    corpo.append(video);
    if (a.descricao) corpo.append(el("p", "adm-ajuda", a.descricao));
    corpo.append(bt);
    abrirModal(a.titulo || "Aula", corpo);
    atualizarBotaoAula(bt, a);
  }

  function atualizarBotaoAula(bt, a) {
    const feita = progressoDe(a.id);
    bt.textContent = feita ? "Desmarcar como assistida" : "Marcar como assistida";
    bt.dataset.feita = feita ? "1" : "0";
  }

  async function marcarAula(bt, a) {
    const vai = bt.dataset.feita !== "1";
    bt.disabled = true;
    const { data, error } = await sb.rpc("ativavid_aula_marcar", { p_aula_id: a.id, p_concluida: vai });
    bt.disabled = false;
    if (error || !data || !data.ok) return recado("Não consegui salvar. Tente de novo.", "erro");
    const lista = estado.dados.progresso || [];
    const reg = { aulaId: a.id, concluida: vai, assistidaEm: vai ? new Date().toISOString() : null };
    const i = lista.findIndex((p) => p.aulaId === a.id);
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    estado.dados.progresso = lista;
    atualizarBotaoAula(bt, a);
    desenharAulas();
    desenharInicio();
    recado(vai ? "Aula marcada como assistida." : "Marcação removida.", "ok");
  }

  /* ---------- conta ---------- */

  function desenharConta() {
    const d = estado.dados;
    const box = $("contaDados");
    box.innerHTML = "";
    const linhas = [
      ["E-mail", d.email],
      ["Assinatura", d.assinatura ? situacaoAssinatura(d.assinatura).rot : "Sem assinatura"],
      ["Válida até", d.assinatura ? dia(d.assinatura.validaAte) : "—"],
      ["Computadores liberados", d.assinatura ? String(d.assinatura.computadores) : "—"],
    ];
    for (const [rot, valor] of linhas) {
      const l = el("div", "aulas-linha-dado");
      l.append(el("span", "adm-kpi-rot", rot), el("strong", "", valor));
      box.append(l);
    }
  }

  /* ---------- navegação ---------- */

  function rotear() {
    const h = (location.hash || "#inicio").replace("#", "");
    const secao = SECOES[h] ? h : "inicio";
    for (const s of Object.keys(SECOES)) {
      $(`sec${s[0].toUpperCase()}${s.slice(1)}`).hidden = s !== secao;
    }
    for (const a of $$(".adm-nav-item")) {
      const on = a.dataset.secao === secao;
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    $("tituloSecao").textContent = SECOES[secao].titulo;
    $("subSecao").textContent = SECOES[secao].sub;
    document.title = `${SECOES[secao].titulo} — Área do aluno ATIVAVID`;
    window.scrollTo(0, 0);
  }

  /* ---------- ligar ---------- */

  $("formEntrar").addEventListener("submit", entrar);
  $("btEsqueci").addEventListener("click", () => mostrarTrocar(true));
  $("btVoltar").addEventListener("click", () => mostrarTrocar(false));
  $("btPedirCodigo").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btReenviar").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btTrocar").addEventListener("click", (e) => trocarSenha(e.currentTarget));
  $("btSair").addEventListener("click", sair);
  $("btTema").addEventListener("click", alternarTema);
  $("btMenu").addEventListener("click", () => aplicarMenu($("painel").classList.contains("adm-app--fechado")));
  $("btPerfil").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("menuPerfil");
    const abrir = menu.hidden;
    menu.hidden = !abrir;
    $("btPerfil").setAttribute("aria-expanded", abrir ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-fechar]")) return fecharModal();
    if (!e.target.closest || !e.target.closest("#menuPerfil, #btPerfil")) fecharMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("modal").hidden) fecharModal();
    else fecharMenus();
  });
  window.addEventListener("hashchange", () => { if (!$("painel").hidden) rotear(); });

  if (embutido) document.getElementById("painel").classList.add("alu-embutido");
  lerPreferencias();
  $("btTema").setAttribute("aria-label", temaEfetivo() === "claro" ? "Usar tema escuro" : "Usar tema claro");

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") mostrarEntrada();
  });

  abrirArea().catch((e) => recado(e.message, "erro"));
})();
