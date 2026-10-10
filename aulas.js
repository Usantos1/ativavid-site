/* Área do aluno — ATIVAVID (versão web).
 *
 * Quem decide o que o aluno vê é o Postgres, não esta página:
 *   ativavid_area_aluno()             aulas, assinatura e uso de quem entrou
 *   ativavid_aula_marcar(...)         marca uma aula como concluída
 *   ativavid_aluno_chamados()         os chamados da própria conta
 *   ativavid_aluno_abrir_chamado(...) abre um chamado
 *   ativavid_aluno_responder(...)     responde um chamado da própria conta
 * Todas leem a conta pelo login (auth.jwt()). Nada aqui chega a outra conta.
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

  const TITULOS = {
    inicio: { titulo: "Início", sub: "" },
    aulas: { titulo: "Aulas", sub: "Assista às aulas e marque as que já viu." },
    suporte: { titulo: "Suporte", sub: "Abra um chamado e acompanhe a resposta da equipe." },
    conta: { titulo: "Conta", sub: "Seu acesso ao ATIVAVID." },
  };
  const SECAO_DO_ID = {
    inicio: "secInicio", aulas: "secAulas", aula: "secAula", suporte: "secSuporte", conta: "secConta",
  };

  const estado = { dados: null, emailTroca: "", chamados: [], chamadoAberto: null };
  let aulaAtual = null;

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
  const hora = (iso) => {
    const t = ms(iso);
    if (!t) return "";
    return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
    const antes = bt.innerHTML;
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
      bt.innerHTML = antes;
    }
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
    estado.uid = session.user.id;
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
    ouvirSuporte();
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

  /* ---------- assinatura e progresso ---------- */

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

  function aulasDaLista() {
    return (estado.dados && estado.dados.aulas) || [];
  }

  function progressoDe(aulaId) {
    return (estado.dados.progresso || []).some((p) => p.aulaId === aulaId && p.concluida);
  }

  function atualizarProgresso(aulaId, concluida) {
    const lista = estado.dados.progresso || [];
    const reg = { aulaId, concluida, assistidaEm: concluida ? new Date().toISOString() : null };
    const i = lista.findIndex((p) => p.aulaId === aulaId);
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    estado.dados.progresso = lista;
  }

  /* ---------- início: primeiros passos e números ---------- */

  function desenharInicio() {
    const d = estado.dados;
    const a = d.assinatura;
    const s = situacaoAssinatura(a);
    const v = d.videos || {};
    const total = v.total || 0;
    const aulas = aulasDaLista();
    const feitas = aulas.filter((x) => progressoDe(x.id)).length;
    const pendente = aulas.find((x) => !progressoDe(x.id)) || aulas[0];
    const ativa = !!a && a.status === "active" && a.diasRestantes >= 0;

    const passos = [
      {
        feito: feitas > 0,
        titulo: "Assista a primeira aula",
        sub: feitas > 0 ? "Você já começou." : "Comece por ela para entender o fluxo do programa.",
        acao: pendente ? { texto: feitas > 0 ? "Continuar" : "Assistir", href: `/aulas/aula/${pendente.id}` } : null,
      },
      {
        feito: aulas.length > 0 && feitas === aulas.length,
        titulo: "Assista a todas as aulas",
        sub: aulas.length ? `${feitas} de ${aulas.length} assistidas` : "Ainda não há aulas publicadas.",
        acao: { texto: "Ver aulas", href: "/aulas/todas" },
      },
      {
        feito: total > 0,
        titulo: "Edite o seu primeiro vídeo",
        sub: total > 0 ? `${total} vídeo${total === 1 ? "" : "s"} editado${total === 1 ? "" : "s"} até agora.` : "Os vídeos que você editar no programa aparecem aqui.",
        acao: null,
      },
      {
        feito: ativa,
        titulo: "Ter a assinatura ativa",
        sub: s.sub,
        acao: { texto: "Ver conta", href: "/aulas/conta" },
      },
    ];

    const lista = $("passosLista");
    lista.replaceChildren();
    passos.forEach((p, i) => {
      const li = el("li", `aulas-passo${p.feito ? " is-feito" : ""}`);
      li.append(el("span", "aulas-passo-marca", p.feito ? "✓" : String(i + 1)));
      const texto = el("span", "aulas-passo-texto");
      texto.append(el("strong", "", p.titulo), el("small", "", p.sub));
      li.append(texto);
      if (p.acao) {
        const link = el("a", "adm-bt adm-bt-fraco adm-bt-sm", p.acao.texto);
        link.href = p.acao.href;
        li.append(link);
      }
      lista.append(li);
    });
    const feitos = passos.filter((p) => p.feito).length;
    $("passosTitulo").textContent = feitos === passos.length ? "Tudo certo por aqui" : "Seus próximos passos";
    $("passosContagem").textContent = `${feitos} de ${passos.length} concluídos`;
    $("passosBarra").style.width = `${Math.round((100 * feitos) / passos.length)}%`;

    const numeros = [
      [total, "Vídeos editados"],
      [v.mes || 0, "Editados neste mês"],
      [`${fmtNum(v.minutosEntregues)} min`, "Vídeo entregue"],
      [`${fmtNum(v.minutosDeFonte)} min`, "Gravação usada"],
      [`${feitas} de ${aulas.length}`, "Aulas assistidas"],
    ];
    const kp = $("kpis");
    kp.replaceChildren();
    for (const [valor, rot] of numeros) {
      const c = el("article", "adm-vidro aulas-stat");
      c.append(el("span", "", rot), el("strong", "", valor));
      kp.append(c);
    }
  }

  /* ---------- grade de aulas ---------- */

  function desenharAulas() {
    const aulas = aulasDaLista();
    const feitas = aulas.filter((a) => progressoDe(a.id)).length;
    $("resumoAulas").textContent = aulas.length
      ? `${feitas} de ${aulas.length} assistidas`
      : "Ainda não há aulas publicadas.";

    const lista = $("listaAulas");
    lista.replaceChildren();
    const grupos = new Map();
    for (const a of aulas) {
      const k = a.secao || "Geral";
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(a);
    }
    for (const [secao, itens] of grupos) {
      lista.append(el("h3", "adm-aluno-secao", secao));
      const grade = el("div", "aulas-grupo-grade");
      for (const a of itens) grade.append(cartaoAula(a));
      lista.append(grade);
    }
  }

  // O cartão inteiro é um link: clicar em qualquer lugar (inclusive a capa)
  // abre a aula em página própria, já tocando.
  function cartaoAula(a) {
    const feita = progressoDe(a.id);
    const link = el("a", "adm-vidro aulas-card");
    link.href = `/aulas/aula/${a.id}`;
    const capa = el("div", "aulas-capa");
    const img = document.createElement("img");
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(a.youtubeId)}/mqdefault.jpg`;
    img.alt = "";
    img.loading = "lazy";
    capa.append(img, el("span", "aulas-play", "▶"));
    const corpo = el("div", "aulas-card-corpo");
    corpo.append(
      el("h4", "", a.titulo || "Aula"),
      el("span", `adm-chip adm-chip-${feita ? "ok" : "espera"}`, feita ? "Concluída" : "Não concluída"),
    );
    link.append(capa, corpo);
    return link;
  }

  /* ---------- a aula, em página própria ---------- */

  // Texto que o admin escreveu vira HTML seguro: parágrafos por linha em
  // branco, quebras de linha dentro do parágrafo e listas com "- ".
  // Nunca usa innerHTML com o texto cru.
  function textoHtml(txt) {
    const frag = document.createDocumentFragment();
    const blocos = String(txt || "").replace(/\r/g, "").split(/\n\s*\n/);
    for (const bloco of blocos) {
      const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!linhas.length) continue;
      if (linhas.every((l) => /^[-•*]\s+/.test(l))) {
        const ul = el("ul", "aulas-lista");
        for (const l of linhas) ul.append(el("li", "", l.replace(/^[-•*]\s+/, "")));
        frag.append(ul);
      } else {
        const p = el("p", "");
        linhas.forEach((l, i) => {
          if (i) p.append(document.createElement("br"));
          p.append(document.createTextNode(l));
        });
        frag.append(p);
      }
    }
    return frag;
  }

  function setLink(id, href) {
    const a = $(id);
    a.hidden = !href;
    if (href) a.href = href;
  }

  function abrirAulaPagina(a) {
    const lista = aulasDaLista();
    const i = lista.findIndex((x) => x.id === a.id);
    if (!aulaAtual || aulaAtual.id !== a.id) {
      const f = $("aulaVideo");
      f.title = a.titulo || "Aula";
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtubeId)}?rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&autoplay=1`;
      $("aulaTitulo").textContent = a.titulo || "Aula";
      const desc = $("aulaDescricao");
      desc.replaceChildren();
      if (a.descricao) desc.append(textoHtml(a.descricao));
      else desc.append(el("p", "adm-ajuda", "Esta aula não tem descrição."));
    }
    aulaAtual = a;
    atualizarBotaoAula();
    const ant = i > 0 ? lista[i - 1] : null;
    const prox = i >= 0 && i < lista.length - 1 ? lista[i + 1] : null;
    setLink("btAnterior", ant ? `/aulas/aula/${ant.id}` : null);
    setLink("btProxima", prox ? `/aulas/aula/${prox.id}` : null);
  }

  function pararAula() {
    aulaAtual = null;
    $("aulaVideo").src = ""; // tira o vídeo da página: para o som
  }

  function atualizarBotaoAula() {
    const bt = $("btConcluir");
    const feita = aulaAtual && progressoDe(aulaAtual.id);
    bt.textContent = feita ? "Desmarcar concluída" : "Marcar como concluída";
    bt.dataset.feita = feita ? "1" : "0";
  }

  // Tela cheia da própria área do vídeo, para as máscaras continuarem por cima.
  $("btTelaCheia").addEventListener("click", () => {
    const area = $("aulaPlayer");
    const pedir = area.requestFullscreen || area.webkitRequestFullscreen;
    if (pedir) pedir.call(area);
  });

  $("btConcluir").addEventListener("click", async () => {
    if (!aulaAtual) return;
    const bt = $("btConcluir");
    const vai = bt.dataset.feita !== "1";
    bt.disabled = true;
    const { data, error } = await sb.rpc("ativavid_aula_marcar", { p_aula_id: aulaAtual.id, p_concluida: vai });
    bt.disabled = false;
    if (error || !data || !data.ok) return recado("Não consegui salvar. Tente de novo.", "erro");
    atualizarProgresso(aulaAtual.id, vai);
    atualizarBotaoAula();
    desenharAulas();
    desenharInicio();
    recado(vai ? "Aula marcada como concluída." : "Marcação removida.", "ok");
  });

  /* ---------- suporte ---------- */

  const ANEXO_TIPOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const ANEXO_MAX_BYTES = 8 * 1024 * 1024;
  const ANEXO_MAX_QTD = 4;
  const anexos = { novo: [], resposta: [] };

  async function carregarChamados() {
    const { data, error } = await sb.rpc("ativavid_aluno_chamados");
    if (error || !data || !data.ok) throw new Error("Não consegui carregar os seus chamados.");
    estado.chamados = data.chamados || [];
  }

  // Status vindo direto da equipe. "Aguardando você" pede resposta do cliente.
  const STATUS_CLIENTE = {
    aberto: { rot: "Aguardando a equipe", tom: "espera" },
    em_analise: { rot: "Em atendimento", tom: "atencao" },
    aguardando_cliente: { rot: "Aguardando você", tom: "atencao" },
    resolvido: { rot: "Resolvido", tom: "ok" },
  };

  function situacaoChamado(c) {
    return STATUS_CLIENTE[c.status] || { rot: c.status, tom: "neutro" };
  }

  function resumo(texto) {
    const t = String(texto || "").replace(/\s+/g, " ").trim();
    return t.length > 80 ? `${t.slice(0, 80)}…` : t;
  }

  function desenharListaChamados() {
    const alvo = $("listaChamados");
    alvo.replaceChildren();
    const lista = estado.chamados;
    $("resumoChamados").textContent = lista.length
      ? `${lista.length} chamado${lista.length === 1 ? "" : "s"}`
      : "";
    if (!lista.length) {
      alvo.append(el("p", "adm-ajuda", "Você ainda não abriu nenhum chamado."));
      return;
    }
    for (const c of lista) {
      const s = situacaoChamado(c);
      const ult = c.mensagens[c.mensagens.length - 1];
      const link = el("a", "adm-vidro aulas-ticket-linha");
      link.href = `/aulas/suporte/${c.id}`;
      const info = el("div", "aulas-ticket-info");
      info.append(
        el("strong", "", c.assunto),
        el("span", "aulas-ticket-previa", ult ? `${ult.autor === "admin" ? "Equipe" : "Você"}: ${resumo(ult.texto)}` : ""),
      );
      link.append(
        el("span", "aulas-ticket-num", `#${c.id}`),
        info,
        el("span", `adm-chip adm-chip-${s.tom}`, s.rot),
        el("span", "adm-msg-hora aulas-ticket-data", dia(c.atualizadoEm)),
      );
      alvo.append(link);
    }
  }

  function horaCurta(iso) {
    const t = ms(iso);
    if (!t) return "";
    return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  // "Hoje", "Ontem" ou a data, para separar os dias na conversa.
  function rotuloDia(iso) {
    const d = new Date(ms(iso));
    const hoje = new Date();
    const ontem = new Date(Date.now() - DIA);
    const igual = (a, b) => a.toDateString() === b.toDateString();
    if (igual(d, hoje)) return "Hoje";
    if (igual(d, ontem)) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function bolhaMensagem(m) {
    const eu = m.autor === "cliente";
    const b = el("div", `aulas-bolha ${eu ? "is-eu" : "is-equipe"}`);
    if (!eu) b.append(el("span", "aulas-bolha-autor", "Equipe ATIVAVID"));
    if (m.anexos && m.anexos.length) {
      const fotos = el("div", "aulas-bolha-fotos");
      for (const a of m.anexos) {
        const link = el("a", "aulas-bolha-foto");
        link.target = "_blank";
        link.rel = "noopener";
        const img = document.createElement("img");
        img.alt = a.nome || "Print";
        img.loading = "lazy";
        link.append(img);
        fotos.append(link);
        carregarImagem(a.path, img, link);
      }
      b.append(fotos);
    }
    if (m.texto) b.append(el("p", "aulas-bolha-texto", m.texto));
    b.append(el("span", "aulas-bolha-hora", horaCurta(m.criadoEm)));
    return b;
  }

  function abrirChamadoDetalhe(id, aoVivo = false) {
    const c = estado.chamados.find((x) => String(x.id) === String(id));
    if (!c) return false;
    const s = situacaoChamado(c);
    $("tituloSecao").textContent = `Chamado #${c.id}`;
    $("subSecao").textContent = c.assunto;
    $("ticketAssunto").textContent = c.assunto;
    $("ticketMeta").textContent = `#${c.id} · aberto em ${dia(c.criadoEm)}` +
      (c.status === "aguardando_cliente" ? " · a equipe aguarda a sua resposta" : "");
    const chip = $("ticketStatus");
    chip.textContent = s.rot;
    chip.className = `adm-chip adm-chip-${s.tom}`;
    // resolvido: some a caixa de mensagem e aparece o aviso de encerramento
    const encerrado = c.status === "resolvido";
    $("formResposta").hidden = encerrado;
    $("chamadoEncerrado").hidden = !encerrado;
    if (encerrado) {
      $("chamadoEncerradoTexto").textContent = `A equipe encerrou este chamado em ${dia(c.atualizadoEm)} às ${horaCurta(c.atualizadoEm)}. Se precisar de mais ajuda, abra um novo chamado.`;
    }
    const conversa = $("ticketConversa");
    const pertoDoFim = conversa.scrollHeight - conversa.scrollTop - conversa.clientHeight < 120;
    conversa.replaceChildren();
    let diaAnterior = "";
    for (const m of c.mensagens) {
      const rotulo = rotuloDia(m.criadoEm);
      if (rotulo !== diaAnterior) {
        conversa.append(el("div", "aulas-dia", rotulo));
        diaAnterior = rotulo;
      }
      conversa.append(bolhaMensagem(m));
    }
    $("formResposta").dataset.chamado = String(c.id);
    if (!aoVivo) {
      anexos.resposta = [];
      desenharAnexos("resposta");
    }
    // ao vivo: só desce se já estava no fim (não atrapalha quem está lendo o começo)
    if (!aoVivo || pertoDoFim) conversa.scrollTop = conversa.scrollHeight;
    return true;
  }

  // Enter envia; Shift+Enter quebra a linha. O campo cresce com o texto.
  $("respostaTexto").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("formResposta").requestSubmit();
    }
  });
  $("respostaTexto").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  });

  // Imagens do bucket privado: link assinado, válido por 1 hora.
  async function carregarImagem(path, img, link) {
    const { data, error } = await sb.storage.from("chamados").createSignedUrl(path, 3600);
    if (error || !data) { img.alt = "Imagem indisponível"; return; }
    img.src = data.signedUrl;
    link.href = data.signedUrl;
  }

  function adicionarAnexos(tipo, arquivos) {
    for (const f of Array.from(arquivos)) {
      if (!ANEXO_TIPOS.includes(f.type)) return recado(`"${f.name}" não é imagem. Envie PNG, JPG, WebP ou GIF.`, "atencao");
      if (f.size > ANEXO_MAX_BYTES) return recado(`"${f.name}" passa de 8 MB.`, "atencao");
      if (anexos[tipo].length >= ANEXO_MAX_QTD) return recado("No máximo 4 imagens por mensagem.", "atencao");
      anexos[tipo].push(f);
    }
    desenharAnexos(tipo);
  }

  function desenharAnexos(tipo) {
    const ul = $(tipo === "novo" ? "chamadoAnexos" : "respostaAnexos");
    ul.replaceChildren();
    anexos[tipo].forEach((f, i) => {
      const item = el("li", "aulas-anexo-item");
      const tirar = el("button", "aulas-anexo-x", "Remover");
      tirar.type = "button";
      tirar.addEventListener("click", () => {
        anexos[tipo].splice(i, 1);
        desenharAnexos(tipo);
      });
      item.append(el("span", "", f.name), tirar);
      ul.append(item);
    });
  }

  // Sobe cada print para a pasta de quem envia e registra o vínculo com a mensagem.
  async function enviarAnexos(chamadoId, mensagemId, arquivos) {
    for (const f of arquivos) {
      const seguro = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80) || "print.png";
      const caminho = `${estado.uid}/${chamadoId}/${Date.now()}-${seguro}`;
      const { error } = await sb.storage.from("chamados").upload(caminho, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(`Não consegui enviar "${f.name}". Tente de novo.`);
      const { data, error: e2 } = await sb.rpc("ativavid_aluno_anexar", {
        p_chamado_id: chamadoId,
        p_mensagem_id: mensagemId,
        p_path: caminho,
        p_nome: f.name,
        p_tipo: f.type,
        p_tamanho: f.size,
      });
      if (e2 || !data || !data.ok) throw new Error((data && data.message) || "Não consegui registrar a imagem.");
    }
  }

  $("chamadoArquivos").addEventListener("change", (e) => {
    adicionarAnexos("novo", e.target.files);
    e.target.value = "";
  });
  $("respostaArquivos").addEventListener("change", (e) => {
    adicionarAnexos("resposta", e.target.files);
    e.target.value = "";
  });

  // Tempo real: o banco avisa quando um chamado, uma mensagem ou um print muda.
  // Vários avisos seguidos viram uma atualização só.
  let suporteAoVivo = null;
  let suporteAtualizando = null;

  function ouvirSuporte() {
    if (suporteAoVivo) return;
    const quando = { event: "*", schema: "public" };
    suporteAoVivo = sb.channel("suporte-aluno")
      .on("postgres_changes", { ...quando, table: "chamados" }, agendarAtualizacaoSuporte)
      .on("postgres_changes", { ...quando, table: "chamados_mensagens" }, agendarAtualizacaoSuporte)
      .on("postgres_changes", { ...quando, table: "chamados_anexos" }, agendarAtualizacaoSuporte)
      .subscribe();
  }

  function agendarAtualizacaoSuporte() {
    clearTimeout(suporteAtualizando);
    suporteAtualizando = setTimeout(atualizarSuporte, 300);
  }

  async function atualizarSuporte() {
    const contaAdmin = (lista) => lista.reduce((n, c) => n + c.mensagens.filter((m) => m.autor === "admin").length, 0);
    const adminAntes = contaAdmin(estado.chamados);
    try {
      await carregarChamados();
    } catch {
      return;
    }
    if (contaAdmin(estado.chamados) > adminAntes) recado("Nova resposta da equipe.", "ok");
    if (!$("suporteLista").hidden) desenharListaChamados();
    const id = idChamadoDaRota();
    if (id && !$("suporteChamado").hidden) abrirChamadoDetalhe(id, true);
  }

  function idChamadoDaRota() {
    const [secao, id] = rotaAtual();
    return secao === "suporte" && id && id !== "novo" ? id : null;
  }

  $("formChamado").addEventListener("submit", async (e) => {
    e.preventDefault();
    const assunto = $("chamadoAssunto").value.trim();
    const texto = $("chamadoTexto").value.trim();
    await ocupado($("btEnviarChamado"), async () => {
      const { data, error } = await sb.rpc("ativavid_aluno_abrir_chamado", { p_assunto: assunto, p_texto: texto });
      if (error || !data || !data.ok) throw new Error((data && data.message) || "Não consegui abrir o chamado. Tente de novo.");
      await enviarAnexos(data.id, data.mensagemId, anexos.novo);
      $("formChamado").reset();
      anexos.novo = [];
      desenharAnexos("novo");
      await carregarChamados();
      recado("Chamado enviado. A equipe responde por aqui.", "ok");
      irPara(`/aulas/suporte/${data.id}`);
    });
  });

  $("formResposta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = Number($("formResposta").dataset.chamado);
    const texto = $("respostaTexto").value.trim();
    if (!texto) return recado("Escreva a sua resposta antes de enviar.", "atencao");
    await ocupado($("btResponder"), async () => {
      const { data, error } = await sb.rpc("ativavid_aluno_responder", { p_id: id, p_texto: texto });
      if (error || !data || !data.ok) throw new Error((data && data.message) || "Não consegui enviar. Tente de novo.");
      await enviarAnexos(id, data.mensagemId, anexos.resposta);
      $("respostaTexto").value = "";
      anexos.resposta = [];
      desenharAnexos("resposta");
      await carregarChamados();
      abrirChamadoDetalhe(id);
      recado("Resposta enviada.", "ok");
    });
  });

  /* ---------- conta ---------- */

  function desenharConta() {
    const d = estado.dados;
    const box = $("contaDados");
    box.replaceChildren();
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

  /* ---------- rotas (endereços de verdade, sem #) ---------- */

  // /aulas · /aulas/todas · /aulas/aula/<id> · /aulas/suporte · /aulas/suporte/novo
  // /aulas/suporte/<número> · /aulas/conta. Devolve [secao, id] no formato que
  // o resto da página usa. Endereço antigo com # ainda é entendido.
  function rotaAtual() {
    let partes = location.pathname.replace(/^\/aulas\/?/, "").split("/").filter(Boolean);
    if (!partes.length && location.hash) partes = location.hash.replace("#", "").split("/").filter(Boolean);
    const [p1, p2] = partes;
    if (!p1 || p1 === "inicio") return ["inicio"];
    if (p1 === "todas") return ["aulas"];
    if (p1 === "aula" || p1 === "aulas") return ["aulas", p2];
    return [p1, p2];
  }

  function caminhoDe(secao, id) {
    if (secao === "aulas") return id ? `/aulas/aula/${id}` : "/aulas/todas";
    if (secao === "inicio") return "/aulas";
    return id ? `/aulas/${secao}/${id}` : `/aulas/${secao}`;
  }

  function irPara(caminho, substituir = false) {
    const url = caminho + location.search;
    if (substituir) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    if (!$("painel").hidden) rotear();
  }

  function rotear() {
    if (!estado.dados) return;
    const [secao, id] = rotaAtual();
    const aula = secao === "aulas" && id ? aulasDaLista().find((x) => x.id === id) : null;
    const chave = aula ? "aula" : (TITULOS[secao] ? secao : "inicio");

    const canonico = caminhoDe(chave === "aula" ? "aulas" : chave, aula ? aula.id : (chave === "suporte" ? id : undefined));
    if (location.pathname !== canonico || location.hash) history.replaceState(null, "", canonico + location.search);

    if (chave !== "aula" && aulaAtual) pararAula();
    for (const [k, sid] of Object.entries(SECAO_DO_ID)) $(sid).hidden = k !== chave;

    // Início e aula não têm cabeçalho: começam direto no conteúdo.
    $("cabSecao").hidden = chave === "inicio" || chave === "aula";

    const navSecao = aula ? "aulas" : chave;
    for (const a of $$(".adm-nav-item")) {
      const on = a.dataset.secao === navSecao;
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }

    if (aula) {
      abrirAulaPagina(aula);
      document.title = `${aula.titulo || "Aula"} — Área do aluno ATIVAVID`;
    } else if (chave === "suporte") {
      rotearSuporte(id);
    } else {
      $("tituloSecao").textContent = TITULOS[chave].titulo;
      $("subSecao").textContent = TITULOS[chave].sub;
      document.title = `${TITULOS[chave].titulo} — Área do aluno ATIVAVID`;
    }
    window.scrollTo(0, 0);
  }

  // Suporte tem três telas: a lista (#suporte), um chamado novo (#suporte/novo)
  // e a conversa de um chamado (#suporte/<número>).
  function rotearSuporte(id) {
    const modo = !id ? "lista" : id === "novo" ? "novo" : "chamado";
    $("suporteLista").hidden = modo !== "lista";
    $("suporteNovo").hidden = modo !== "novo";
    $("suporteChamado").hidden = modo !== "chamado";
    // na conversa, o cabeçalho do chat já mostra o chamado
    $("cabSecao").hidden = modo === "chamado";
    if (modo === "novo") {
      $("tituloSecao").textContent = "Novo chamado";
      $("subSecao").textContent = "Conte o que aconteceu. Um print ajuda muito.";
      document.title = "Novo chamado — Área do aluno ATIVAVID";
    } else {
      $("tituloSecao").textContent = "Suporte";
      $("subSecao").textContent = "Abra um chamado e acompanhe a resposta da equipe.";
      document.title = "Suporte — Área do aluno ATIVAVID";
    }
    carregarChamados()
      .then(() => {
        if (modo === "lista") return desenharListaChamados();
        if (modo === "chamado" && !abrirChamadoDetalhe(id)) irPara("/aulas/suporte", true);
      })
      .catch((e) => recado(e.message, "erro"));
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
    if (!e.target.closest || !e.target.closest("#menuPerfil, #btPerfil")) fecharMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharMenus();
  });
  window.addEventListener("popstate", () => { if (!$("painel").hidden) rotear(); });
  // links internos trocam de tela sem recarregar
  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest('a[href^="/aulas"]');
    if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    irPara(link.getAttribute("href"));
  });

  if (embutido) $("painel").classList.add("alu-embutido");
  lerPreferencias();
  $("btTema").setAttribute("aria-label", temaEfetivo() === "claro" ? "Usar tema escuro" : "Usar tema claro");

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") mostrarEntrada();
  });

  abrirArea().catch((e) => recado(e.message, "erro"));
})();
