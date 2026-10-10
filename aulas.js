/* Área do aluno — ATIVAVID (versão web).
 *
 * Quem decide o que o aluno vê é o Postgres, não esta página:
 *   ativavid_area_aluno()        aulas, assinatura e uso de quem entrou
 *   ativavid_aula_marcar(...)    marca uma aula como assistida
 * As duas usam o login (auth.jwt()). Nada aqui chega a outra conta.
 */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";

  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
  const DIA = 86400000;

  const estado = { dados: null, email: "", emailTroca: "", aulaAberta: null };
  // Dentro do painel admin (Academy) não há botão Sair: sair seria sair do painel.
  const painel = new URLSearchParams(location.search).has("painel");
  if (painel) document.body.classList.add("alu--embutido");

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = String(txt);
    return n;
  };

  const fmtData = (iso) => new Date(iso).toLocaleDateString("pt-BR");
  const fmtNum = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

  function aviso(msg) {
    const a = $("aviso");
    a.textContent = msg;
    a.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { a.hidden = true; }, 2600);
  }

  function erro(id, msg) {
    const n = $(id);
    n.textContent = msg || "";
    n.hidden = !msg;
  }

  function traduz(err) {
    const m = ((err && err.message) || "").toLowerCase();
    if (m.includes("invalid login")) return "E-mail ou senha não batem. Confira e tente de novo.";
    if (m.includes("email not confirmed")) return "Este e-mail ainda não foi confirmado.";
    if (m.includes("rate") || m.includes("too many")) return "Muitas tentativas. Espere um pouco e tente de novo.";
    return "Não deu para entrar agora. Tente de novo em instantes.";
  }

  function mostrar(qual) {
    $("telaEntrar").hidden = qual === "area";
    $("formEntrar").hidden = qual !== "entrar";
    $("formTrocar").hidden = qual !== "trocar";
    $("area").hidden = qual !== "area";
  }

  /* ---------- entrar ---------- */

  $("formEntrar").addEventListener("submit", async (e) => {
    e.preventDefault();
    erro("erroEntrar", "");
    const email = $("email").value.trim();
    const senha = $("senha").value;
    if (!email || !senha) return erro("erroEntrar", "Digite o e-mail e a senha.");
    const bt = $("btEntrar");
    bt.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    bt.disabled = false;
    if (error) return erro("erroEntrar", traduz(error));
    $("senha").value = "";
    await abrirArea();
  });

  $("btEsqueci").addEventListener("click", async () => {
    erro("erroEntrar", "");
    const email = $("email").value.trim();
    if (!email) return erro("erroEntrar", "Digite o seu e-mail acima e clique de novo.");
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) return erro("erroEntrar", traduz(error));
    estado.emailTroca = email;
    mostrar("trocar");
    aviso("Mandamos um código para o seu e-mail.");
  });

  $("formTrocar").addEventListener("submit", async (e) => {
    e.preventDefault();
    erro("erroTrocar", "");
    const codigo = $("codigo").value.trim();
    const senha = $("novaSenha").value;
    if (senha.length < 8) return erro("erroTrocar", "A nova senha precisa de pelo menos 8 caracteres.");
    const { error: e1 } = await sb.auth.verifyOtp({ email: estado.emailTroca, token: codigo, type: "recovery" });
    if (e1) return erro("erroTrocar", "Código inválido ou vencido. Peça um novo.");
    const { error: e2 } = await sb.auth.updateUser({ password: senha });
    if (e2) return erro("erroTrocar", "Não consegui salvar a senha. Tente de novo.");
    $("novaSenha").value = "";
    $("codigo").value = "";
    aviso("Senha trocada.");
    await abrirArea();
  });

  $("btVoltar").addEventListener("click", () => mostrar("entrar"));

  $("btSair").addEventListener("click", async () => {
    await sb.auth.signOut();
    estado.dados = null;
    mostrar("entrar");
  });

  /* ---------- área ---------- */

  async function abrirArea() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostrar("entrar");
    $("btSair").hidden = painel;
    mostrar("area");
    await carregar();
    rotear();
  }

  async function carregar() {
    const { data, error } = await sb.rpc("ativavid_area_aluno");
    if (!error && data && data.ok) {
      estado.dados = data;
      estado.email = data.email;
      $("emailConta").textContent = data.email;
      desenharInicio();
      desenharAulas();
      return;
    }
    if (data && data.error === "login") {
      await sb.auth.signOut();
      return mostrar("entrar");
    }
    aviso("Não consegui carregar os seus dados. Atualize a página.");
  }

  function situacaoAssinatura(a) {
    if (!a) return { rot: "Sem assinatura", tom: "parado", sub: "Esta conta ainda não tem assinatura ativa." };
    const ate = fmtData(a.validaAte);
    if (a.status !== "active" || a.diasRestantes < 0) return { rot: "Vencida", tom: "parado", sub: `Venceu em ${ate}.` };
    if (a.diasRestantes <= 7) {
      const d = a.diasRestantes;
      return { rot: `Vence em ${d} dia${d === 1 ? "" : "s"}`, tom: "atencao", sub: `Válida até ${ate}.` };
    }
    return { rot: "Ativa", tom: "ok", sub: `Válida até ${ate} · ${a.diasRestantes} dias restantes.` };
  }

  function desenharInicio() {
    const d = estado.dados;
    const nome = (d.email || "").split("@")[0];
    $("nomeSaudacao").textContent = nome ? `, ${nome}` : "";

    const s = situacaoAssinatura(d.assinatura);
    const card = $("cardAssinatura");
    card.replaceChildren(
      el("p", "alu-rotulo", "Assinatura"),
      el("span", `alu-pilula alu-pilula-${s.tom}`, s.rot),
      el("p", "alu-ajuda", s.sub),
    );
    if (d.assinatura) card.append(el("p", "alu-ajuda", `Computadores liberados: ${d.assinatura.computadores}.`));

    const v = d.videos || {};
    const aulas = d.aulas || [];
    const feitas = (d.progresso || []).filter((p) => p.concluida).length;
    const numeros = [
      [v.total || 0, "vídeos editados"],
      [v.mes || 0, "editados neste mês"],
      [fmtNum(v.minutosEntregues), "min de vídeo entregue"],
      [fmtNum(v.minutosDeFonte), "min de gravação usados"],
      [`${feitas} de ${aulas.length}`, "aulas assistidas"],
    ];
    const grade = $("numeros");
    grade.replaceChildren();
    for (const [valor, rotulo] of numeros) {
      const c = el("article", "alu-vidro alu-card alu-numero");
      c.append(el("strong", "", valor), el("span", "", rotulo));
      grade.append(c);
    }
  }

  function desenharAulas() {
    const aulas = estado.dados.aulas || [];
    const feitas = new Set((estado.dados.progresso || []).filter((p) => p.concluida).map((p) => p.aulaId));
    const pct = aulas.length ? Math.round((100 * aulas.filter((a) => feitas.has(a.id)).length) / aulas.length) : 0;
    $("barraAulas").style.width = `${pct}%`;
    $("resumoAulas").textContent = aulas.length
      ? `${feitas.size} de ${aulas.length} assistidas`
      : "Ainda não há aulas publicadas.";

    const lista = $("listaAulas");
    lista.replaceChildren();
    const grupos = new Map();
    for (const a of aulas) {
      if (!grupos.has(a.secao)) grupos.set(a.secao, []);
      grupos.get(a.secao).push(a);
    }
    for (const [secao, itens] of grupos) {
      const g = el("div", "alu-grupo");
      g.append(el("h2", "", secao));
      for (const a of itens) g.append(linhaAula(a, feitas.has(a.id)));
      lista.append(g);
    }
  }

  function linhaAula(a, feita) {
    const b = el("button", "alu-aula");
    b.type = "button";
    b.dataset.feita = feita ? "1" : "0";
    const texto = el("div", "");
    texto.append(
      el("div", "alu-aula-titulo", a.titulo),
      el("div", "alu-aula-sub", feita ? "Assistida" : "Não assistida"),
    );
    b.append(el("span", "alu-check", "✓"), texto, el("span", "alu-aula-play", feita ? "Rever" : "Assistir"));
    b.addEventListener("click", () => abrirAula(a));
    return b;
  }

  /* ---------- janela da aula ---------- */

  function abrirAula(a) {
    estado.aulaAberta = a;
    $("janelaTitulo").textContent = a.titulo;
    $("janelaDescricao").textContent = a.descricao || "";
    $("janelaVideo").src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtubeId)}?rel=0`;
    atualizarBotaoAula();
    $("janela").hidden = false;
  }

  function atualizarBotaoAula() {
    const a = estado.aulaAberta;
    if (!a) return;
    const feita = (estado.dados.progresso || []).some((p) => p.aulaId === a.id && p.concluida);
    const bt = $("btConcluir");
    bt.textContent = feita ? "Desmarcar como assistida" : "Marcar como assistida";
    bt.dataset.feita = feita ? "1" : "0";
  }

  function fecharAula() {
    $("janela").hidden = true;
    $("janelaVideo").src = "";
    estado.aulaAberta = null;
  }

  $("janela").addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-fechar]")) fecharAula();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("janela").hidden) fecharAula();
  });

  $("btConcluir").addEventListener("click", async () => {
    const a = estado.aulaAberta;
    if (!a) return;
    const bt = $("btConcluir");
    const vai = bt.dataset.feita !== "1";
    bt.disabled = true;
    const { data, error } = await sb.rpc("ativavid_aula_marcar", { p_aula_id: a.id, p_concluida: vai });
    bt.disabled = false;
    if (error || !data || !data.ok) return aviso("Não consegui salvar. Tente de novo.");
    const lista = estado.dados.progresso || [];
    const reg = { aulaId: a.id, concluida: vai, assistidaEm: vai ? new Date().toISOString() : null };
    const i = lista.findIndex((p) => p.aulaId === a.id);
    if (i >= 0) lista[i] = reg;
    else lista.push(reg);
    estado.dados.progresso = lista;
    atualizarBotaoAula();
    desenharAulas();
    desenharInicio();
    aviso(vai ? "Aula marcada como assistida." : "Marcação removida.");
  });

  /* ---------- rotas por # ---------- */

  function rotear() {
    const h = (location.hash || "#inicio").slice(1);
    const secao = ["inicio", "aulas", "conta"].includes(h) ? h : "inicio";
    $("secInicio").hidden = secao !== "inicio";
    $("secAulas").hidden = secao !== "aulas";
    $("secConta").hidden = secao !== "conta";
    for (const a of $$(".alu-abas a")) {
      if (a.dataset.secao === secao) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", rotear);

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") mostrar("entrar");
  });

  abrirArea();
})();
