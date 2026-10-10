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
        acao: pendente ? { texto: feitas > 0 ? "Continuar" : "Assistir", href: `#aulas/${pendente.id}` } : null,
      },
      {
        feito: aulas.length > 0 && feitas === aulas.length,
        titulo: "Assista a todas as aulas",
        sub: aulas.length ? `${feitas} de ${aulas.length} assistidas` : "Ainda não há aulas publicadas.",
        acao: { texto: "Ver aulas", href: "#aulas" },
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
        acao: { texto: "Ver conta", href: "#conta" },
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
    link.href = `#aulas/${a.id}`;
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
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtubeId)}?rel=0&autoplay=1`;
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
    setLink("btAnterior", ant ? `#aulas/${ant.id}` : null);
    setLink("btProxima", prox ? `#aulas/${prox.id}` : null);
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

  async function carregarChamados() {
    const { data, error } = await sb.rpc("ativavid_aluno_chamados");
    if (error || !data || !data.ok) return recado("Não consegui carregar os seus chamados.", "erro");
    estado.chamados = data.chamados || [];
    desenharChamados();
  }

  function situacaoChamado(c) {
    if (c.status === "resolvido") return { rot: "Resolvido", tom: "ok" };
    const ult = c.mensagens[c.mensagens.length - 1];
    if (ult && ult.autor === "admin") return { rot: "Respondido", tom: "atencao" };
    return { rot: "Aguardando a equipe", tom: "espera" };
  }

  function desenharChamados() {
    const alvo = $("listaChamados");
    alvo.replaceChildren();
    if (!estado.chamados.length) {
      alvo.append(el("p", "adm-ajuda", "Você ainda não abriu nenhum chamado."));
      return;
    }
    for (const c of estado.chamados) alvo.append(cartaoChamado(c));
  }

  function cartaoChamado(c) {
    const s = situacaoChamado(c);
    const aberto = estado.chamadoAberto === c.id;
    const card = el("article", "adm-vidro adm-painel aulas-chamado");
    const cab = el("button", "aulas-chamado-cab");
    cab.type = "button";
    cab.setAttribute("aria-expanded", aberto ? "true" : "false");
    cab.append(
      el("strong", "", c.assunto),
      el("span", `adm-chip adm-chip-${s.tom}`, s.rot),
      el("span", "adm-msg-hora", `Aberto em ${dia(c.criadoEm)}`),
    );
    cab.addEventListener("click", () => {
      estado.chamadoAberto = aberto ? null : c.id;
      desenharChamados();
    });
    card.append(cab);
    if (!aberto) return card;

    const conversa = el("div", "aulas-conversa");
    for (const m of c.mensagens) {
      const eu = m.autor === "cliente";
      const linha = el("div", `adm-msg adm-msg-${eu ? "eu" : "cliente"}`);
      linha.append(
        el("p", "adm-msg-texto", m.texto),
        el("span", "adm-msg-hora", `${eu ? "Você" : "Equipe ATIVAVID"} · ${hora(m.criadoEm)}`),
      );
      conversa.append(linha);
    }
    const form = el("form", "aulas-form");
    const area = document.createElement("textarea");
    area.rows = 3;
    area.placeholder = "Escreva a sua resposta";
    const bt = el("button", "adm-bt adm-bt-forte adm-bt-sm", "Responder");
    bt.type = "submit";
    form.append(area, bt);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const texto = area.value.trim();
      if (!texto) return recado("Escreva a sua resposta antes de enviar.", "atencao");
      await ocupado(bt, async () => {
        const { data, error } = await sb.rpc("ativavid_aluno_responder", { p_id: c.id, p_texto: texto });
        if (error || !data || !data.ok) throw new Error((data && data.message) || "Não consegui enviar. Tente de novo.");
        await carregarChamados();
        recado("Resposta enviada.", "ok");
      });
    });
    card.append(conversa, form);
    return card;
  }

  $("formChamado").addEventListener("submit", async (e) => {
    e.preventDefault();
    const assunto = $("chamadoAssunto").value.trim();
    const texto = $("chamadoTexto").value.trim();
    await ocupado($("btEnviarChamado"), async () => {
      const { data, error } = await sb.rpc("ativavid_aluno_abrir_chamado", { p_assunto: assunto, p_texto: texto });
      if (error || !data || !data.ok) throw new Error((data && data.message) || "Não consegui abrir o chamado. Tente de novo.");
      $("formChamado").reset();
      estado.chamadoAberto = data.id;
      await carregarChamados();
      recado("Chamado enviado. A equipe responde por aqui.", "ok");
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

  /* ---------- rotas por # ---------- */

  function rotear() {
    if (!estado.dados) return;
    const [secao, id] = (location.hash || "#inicio").replace("#", "").split("/");
    const aula = secao === "aulas" && id ? aulasDaLista().find((x) => x.id === id) : null;
    const chave = aula ? "aula" : (TITULOS[secao] ? secao : "inicio");

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
    } else {
      $("tituloSecao").textContent = TITULOS[chave].titulo;
      $("subSecao").textContent = TITULOS[chave].sub;
      document.title = `${TITULOS[chave].titulo} — Área do aluno ATIVAVID`;
    }
    if (chave === "suporte") carregarChamados().catch((e) => recado(e.message, "erro"));
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
    if (!e.target.closest || !e.target.closest("#menuPerfil, #btPerfil")) fecharMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharMenus();
  });
  window.addEventListener("hashchange", () => { if (!$("painel").hidden) rotear(); });

  if (embutido) $("painel").classList.add("alu-embutido");
  lerPreferencias();
  $("btTema").setAttribute("aria-label", temaEfetivo() === "claro" ? "Usar tema escuro" : "Usar tema claro");

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") mostrarEntrada();
  });

  abrirArea().catch((e) => recado(e.message, "erro"));
})();
