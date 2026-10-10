/* Painel admin — ATIVAVID
 *
 * Quem decide o que cada chamada pode fazer é o Postgres, não esta página:
 *   ativavid_quem_sou()                 papel, nome e foto de quem entrou
 *   ativavid_admin_clientes()           ficha inteira (só admin)
 *   ativavid_admin_license(...)         prazo e bloqueio de assinatura (só admin)
 *   ativavid_admin_editar_conta(...)    computadores e anotação (só admin)
 *   ativavid_admin_aulas(...)           aulas (só admin)
 *   ativavid_aulas()                    a lista que o cliente vê (pública)
 *   ativavid_admin_chamados / _chamado / _responder   suporte (equipe)
 *   ativavid_admin_equipe*(...)         equipe (só admin)
 *   ativavid_admin_perfil_salvar(...)   nome e foto de quem está logado
 *   Edge Function admin-contas          criar login, apagar conta, bloquear computador
 *
 * A chave abaixo é a ANON, pública de propósito.
 */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";
  const TRIAL_DIAS = 7;
  const DIA = 86400000;
  const CHECKOUT_ANUAL = "https://buy.stripe.com/5kQ7sMexzgip2Tk8wwdwc00";
  const CHECKOUT_MENSAL = "https://buy.stripe.com/9B63cw0GJ6HPfG6aEEdwc01";

  const SECOES = {
    visao: { titulo: "Visão geral", sub: "O que precisa de atenção hoje.", admin: true },
    clientes: { titulo: "Clientes", sub: "Assinaturas, computadores, uso e aulas assistidas.", admin: true },
    aulas: { titulo: "Aulas", sub: "O que o cliente vê na área de aulas. Cada aula é um vídeo do YouTube.", admin: true },
    suporte: { titulo: "Suporte", sub: "Chamados dos clientes. Responda aqui; a resposta aparece na conta dele.", admin: false },
    equipe: { titulo: "Equipe", sub: "Quem entra neste painel e o que cada pessoa pode fazer.", admin: true },
    academy: { titulo: "Academy", sub: "A área do aluno com a sua conta: o que o cliente vê.", admin: false },
  };

  const STATUS_CHAMADO = {
    aberto: { rot: "Novo", tom: "mal" },
    em_analise: { rot: "Em atendimento", tom: "atencao" },
    aguardando_cliente: { rot: "Aguardando cliente", tom: "neutro" },
    resolvido: { rot: "Resolvido", tom: "ok" },
  };

  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const estado = {
    papel: "",
    email: "",
    nome: "",
    foto: "",
    secao: "visao",
    clientes: [],
    semAssinatura: [],
    filtro: "todos",
    ordem: "vencimento",
    abertos: new Set(),
    aulas: [],
    emailTroca: "",
    chamados: [],
    filtroChamado: "ativos",
    chamadoAberto: null,
    equipe: [],
  };

  // ============================================================ utilidades

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

  const rel = (iso) => {
    const t = ms(iso);
    if (!t) return "nunca";
    const d = Date.now() - t;
    if (d < 60000) return "agora";
    if (d < 3600000) return `há ${Math.floor(d / 60000)} min`;
    if (d < DIA) return `há ${Math.floor(d / 3600000)} h`;
    if (d < 30 * DIA) {
      const n = Math.floor(d / DIA);
      return n === 1 ? "há 1 dia" : `há ${n} dias`;
    }
    return dia(iso);
  };

  const diasAte = (iso) => Math.ceil((ms(iso) - Date.now()) / DIA);

  const iniciais = (texto) => {
    const base = String(texto || "?").split("@")[0].replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    const p = base.split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] || p[0] || "")[0]).toUpperCase();
  };

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

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
    if (tom) e.dataset.tom = tom; else delete e.dataset.tom;
    e.hidden = false;
  }

  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args || {});
    if (error) throw new Error(error.message || "Falhou a chamada ao servidor.");
    if (data && data.ok === false) throw new Error(data.message || data.error || "Recusado.");
    return data || {};
  }

  const licenca = (acao, args) => rpc("ativavid_admin_license", Object.assign({ p_action: acao }, args || {}));

  async function fn(corpo) {
    const { data, error } = await sb.functions.invoke("admin-contas", { body: corpo });
    if (error) {
      let detalhe = "";
      try { detalhe = (await error.context?.json())?.message || ""; } catch { /* sem corpo */ }
      throw new Error(detalhe || error.message || "Falhou a chamada ao servidor.");
    }
    if (data && data.ok === false) throw new Error(data.message || "Recusado.");
    return data || {};
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

  function doisToques(bt, acao) {
    if (bt.dataset.armado === "1") {
      clearTimeout(bt._t);
      bt.dataset.armado = "0";
      bt.textContent = bt._antes;
      bt.classList.remove("is-armado");
      acao();
      return;
    }
    bt.dataset.armado = "1";
    bt._antes = bt.textContent;
    bt.textContent = "Confirmar?";
    bt.classList.add("is-armado");
    bt._t = setTimeout(() => {
      bt.dataset.armado = "0";
      bt.textContent = bt._antes;
      bt.classList.remove("is-armado");
    }, 4000);
  }

  // ============================================================ modal

  function abrirModal(titulo, corpo) {
    $("modalTitulo").textContent = titulo;
    const alvo = $("modalCorpo");
    alvo.innerHTML = "";
    alvo.appendChild(corpo);
    $("modal").hidden = false;
    document.body.classList.add("adm-travado");
    setTimeout(() => {
      const f = alvo.querySelector("input, textarea, select");
      if (f) f.focus();
    }, 40);
  }

  function fecharModal() {
    $("modal").hidden = true;
    $("modal").querySelector(".adm-modal-caixa").classList.remove("adm-modal-largo");
    $("modalCorpo").innerHTML = "";
    document.body.classList.remove("adm-travado");
  }

  function campo(rotulo, input, ajuda) {
    const w = el("label", "adm-campo");
    w.append(el("span", "", rotulo), input);
    if (ajuda) w.append(el("small", "", ajuda));
    return w;
  }

  function entrada(tipo, valor, attrs) {
    const i = document.createElement("input");
    i.type = tipo;
    if (valor != null) i.value = valor;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
    return i;
  }

  function botoes(...bts) {
    const d = el("div", "adm-form-acoes");
    d.append(...bts);
    return d;
  }

  function botao(texto, classe, onClick) {
    const b = el("button", classe, texto);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  // ============================================================ preferências

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

  // ============================================================ regras

  function planoDe(c) {
    const restam = diasAte(c.validoAte);
    const total = (ms(c.validoAte) - ms(c.clienteDesde)) / DIA;
    let nome;
    if (total >= 300) nome = "Anual";
    else if (total >= 25 && total <= 40) nome = "Mensal";
    else {
      const n = Math.max(1, Math.round(total));
      nome = `Prazo de ${n} ${n === 1 ? "dia" : "dias"}`;
    }
    return { nome, total, restam };
  }

  function situacaoDe(c) {
    if (c.status === "revoked") return { k: "bloqueada", rot: "Bloqueada", tom: "mal" };
    if (!c.temLogin) return { k: "semlogin", rot: "Sem login", tom: "espera" };
    const restam = diasAte(c.validoAte);
    if (restam < 0) return { k: "vencida", rot: "Vencida", tom: "mal" };
    if (restam <= 30) return { k: "vencendo", rot: `Vence em ${restam} dia${restam === 1 ? "" : "s"}`, tom: "atencao" };
    return { k: "ativa", rot: "Ativa", tom: "ok" };
  }

  function ultimoAcessoDo(c) {
    const ts = [ms(c.ultimaAbertura), ...(c.computadores || []).map((m) => ms(m.ultimoAcesso))];
    const max = Math.max(0, ...ts);
    return max ? new Date(max).toISOString() : "";
  }

  function estadoMaquina(m, c) {
    if (m.bloqueadoEm) return { rot: "Bloqueado", tom: "mal" };
    if (c) {
      const s = situacaoDe(c);
      if (s.k === "vencida" || s.k === "bloqueada") return { rot: "Parado", tom: "mal" };
      return { rot: "Ativo", tom: "ok" };
    }
    if (m.trialInicio) {
      const restam = Math.ceil((ms(m.trialInicio) + TRIAL_DIAS * DIA - Date.now()) / DIA);
      if (restam > 0) return { rot: `Trial · ${restam} dia${restam === 1 ? "" : "s"}`, tom: "atencao" };
      return { rot: "Trial acabou", tom: "espera" };
    }
    return { rot: "Sem licença", tom: "espera" };
  }

  const ultimoEmailDo = (m) => m.ultimoEmailAberto || m.emailNoPc || "";

  function chip(rot, tom, extra) {
    const s = el("span", `adm-chip adm-chip-${tom || "neutro"}`, rot);
    if (extra) s.classList.add(extra);
    return s;
  }

  function avatar(texto, tom, extra) {
    return el("span", `adm-avatar adm-avatar-${tom || "neutro"}${extra ? " " + extra : ""}`, texto);
  }

  function shortId(id) {
    const s = String(id || "");
    return s.length > 14 ? `${s.slice(0, 14)}…` : s;
  }

  // ============================================================ perfil

  function desenharPerfil() {
    const nome = estado.nome && estado.nome !== "owner" ? estado.nome : (estado.email.split("@")[0] || "Admin");
    const iniciaisTxt = iniciais(nome);
    for (const id of ["avatarUsuario", "avatarMenu"]) {
      const alvo = $(id);
      alvo.innerHTML = "";
      if (estado.foto) {
        const img = document.createElement("img");
        img.src = estado.foto;
        img.alt = "";
        alvo.appendChild(img);
      } else {
        alvo.textContent = iniciaisTxt;
      }
    }
    $("nomeMenu").textContent = nome;
    $("quem").textContent = estado.email;
    $("papelUsuario").textContent = estado.papel === "admin" ? "Admin" : "Suporte";
  }

  function editarPerfil() {
    let fotoNova = null;
    let removeu = false;
    const corpo = el("form", "adm-form-modal");
    const nome = entrada("text", estado.nome === "owner" ? "" : estado.nome, { maxlength: "60", placeholder: "Como você quer ser chamado" });

    const quadro = el("div", "adm-foto-quadro");
    const previa = el("div", "adm-foto-previa");
    const reexibir = () => {
      previa.innerHTML = "";
      const url = removeu ? "" : (fotoNova != null ? fotoNova : estado.foto);
      if (url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        previa.appendChild(img);
      } else {
        previa.textContent = iniciais(nome.value || estado.email);
      }
    };
    const escolher = entrada("file", null, { accept: "image/*", class: "adm-sr", id: "fotoArquivo" });
    const trocar = botao("Trocar foto", "adm-bt adm-bt-fraco adm-bt-sm", () => escolher.click());
    const remover = botao("Remover foto", "adm-bt adm-bt-perigo adm-bt-sm", () => {
      removeu = true; fotoNova = null; reexibir();
    });
    quadro.append(previa, el("div", "adm-foto-acoes", ""));
    quadro.lastChild.append(trocar, remover);

    escolher.addEventListener("change", () => {
      const arq = escolher.files && escolher.files[0];
      if (!arq) return;
      if (!arq.type.startsWith("image/")) return recado("Escolha uma imagem.", "erro");
      const leitor = new FileReader();
      leitor.onload = () => {
        const img = new Image();
        img.onload = () => {
          const lado = 256;
          const c = document.createElement("canvas");
          c.width = lado; c.height = lado;
          const ctx = c.getContext("2d");
          const m = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
          fotoNova = c.toDataURL("image/jpeg", 0.86);
          removeu = false;
          reexibir();
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arq);
    });
    nome.addEventListener("input", () => { if (!estado.foto && !fotoNova && !removeu) reexibir(); });
    reexibir();

    const salvar = botao("Salvar perfil", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    corpo.append(
      quadro,
      escolher,
      campo("Nome", nome, "É como o seu nome aparece no painel e nas respostas do suporte."),
      el("p", "adm-ajuda", `E-mail: ${estado.email}. Para trocar o e-mail, peça ao admin.`),
      botoes(salvar)
    );
    corpo.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ocupado(salvar, async () => {
        const foto = removeu ? "" : fotoNova;
        const r = await rpc("ativavid_admin_perfil_salvar", {
          p_nome: nome.value.trim(),
          p_foto: foto,
        });
        await carregarQuemSou();
        fecharModal();
        recado(r.message || "Perfil salvo.", "ok");
      });
    });
    abrirModal("Editar perfil", corpo);
  }

  async function carregarQuemSou() {
    const quem = await rpc("ativavid_quem_sou");
    estado.papel = quem.papel;
    estado.email = String(quem.email || "");
    estado.nome = String(quem.nome || "");
    estado.foto = String(quem.foto || "");
    aplicarPapel();
    desenharPerfil();
  }

  function aplicarPapel() {
    const admin = estado.papel === "admin";
    $$("[data-so-admin]").forEach((n) => { n.hidden = !admin; });
  }

  // ============================================================ entrar / sair

  async function abrirPainel() {
    try {
      await carregarQuemSou();
    } catch (e) {
      await sb.auth.signOut();
      return { ok: false, motivo: "erro", detalhe: (e && e.message) || "" };
    }
    if (!estado.papel) {
      await sb.auth.signOut();
      return { ok: false, motivo: "nao_equipe" };
    }
    $("telaEntrar").hidden = true;
    $("painel").hidden = false;
    $("senha").value = "";
    if (estado.papel === "admin") await carregar();
    await carregarChamados(true).catch(() => {});
    rotear();
    ouvirSuporte();
    return { ok: true };
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
      const r = await abrirPainel();
      if (r.ok) return;
      if (r.motivo === "nao_equipe") {
        throw new Error(`A conta ${email} entrou, mas não faz parte da equipe. Peça ao admin para adicionar você.`);
      }
      throw new Error(r.detalhe || "O servidor não confirmou quem é você. Tente de novo.");
    }, "erroEntrar");
  }

  async function sair() {
    await sb.auth.signOut();
    location.reload();
  }

  function mostrarTrocar(mostrar) {
    $("formEntrar").hidden = mostrar;
    $("formTrocar").hidden = !mostrar;
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
      if (e2) {
        const m = (e2.message || "").toLowerCase();
        if (m.includes("different")) throw new Error("A senha nova precisa ser diferente da antiga.");
        throw new Error(e2.message || "Não consegui trocar a senha.");
      }
      const r = await abrirPainel();
      if (r.ok) return;
      mostrarTrocar(false);
      avisarEntrar("erroEntrar", r.motivo === "nao_equipe"
        ? `Senha trocada. Mas ${estado.emailTroca} não faz parte da equipe — use a senha nova no aplicativo.`
        : "Senha trocada, mas o servidor não confirmou quem é você. Entre de novo.", "ok");
    }, "avisoTrocar");
  }

  // ============================================================ navegação

  function secaoPermitida(s) {
    const cfg = SECOES[s];
    if (!cfg) return false;
    return !cfg.admin || estado.papel === "admin";
  }

  function secaoDoHash() {
    const h = location.hash.replace("#", "");
    if (secaoPermitida(h)) return h;
    return estado.papel === "admin" ? "visao" : "suporte";
  }

  function rotear() {
    const s = secaoDoHash();
    estado.secao = s;
    $$(".adm-nav-item").forEach((a) => {
      const on = a.dataset.secao === s;
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const mapa = { visao: "secVisao", clientes: "secClientes", aulas: "secAulas", suporte: "secSuporte", equipe: "secEquipe", academy: "secAcademy" };
    for (const [k, id] of Object.entries(mapa)) $(id).hidden = k !== s;
    // no suporte a página não rola: lista e conversa rolam por dentro
    document.documentElement.classList.toggle("adm-sem-rolagem", s === "suporte");
    if (s === "suporte") requestAnimationFrame(ajustarAlturaSuporte);
    $("tituloSecao").textContent = SECOES[s].titulo;
    $("subSecao").textContent = SECOES[s].sub;
    document.title = `${SECOES[s].titulo} — Painel admin ATIVAVID`;
    if (s === "aulas") carregarAulas().catch((e) => recado(e.message, "erro"));
    if (s === "suporte") carregarChamados().catch((e) => recado(e.message, "erro"));
    if (s === "equipe") carregarEquipe().catch((e) => recado(e.message, "erro"));
    if (s === "clientes") desenharClientes();
    if (s === "academy") abrirAcademy();
    window.scrollTo(0, 0);
  }

  // ============================================================ carregar

  async function carregar() {
    const { data, error } = await sb.rpc("ativavid_admin_clientes");
    if (error) { recado(error.message || "Falhou ao carregar.", "erro"); return; }
    if (!data || data.ok === false) { recado((data && data.message) || "Sem permissão.", "erro"); return; }
    estado.clientes = Array.isArray(data.clientes) ? data.clientes : [];
    estado.semAssinatura = Array.isArray(data.semAssinatura) ? data.semAssinatura : [];
    desenharVisao();
    desenharFiltros();
    desenharClientes();
    const n = $("navClientes");
    n.textContent = String(estado.clientes.length + estado.semAssinatura.length);
    n.hidden = false;
  }

  // ============================================================ visão geral

  // Receita recorrente ESTIMADA: plano de cada cliente ativo x tabela de preços
  // atual. As vendas antigas não gravaram o valor pago (licenses.amount_cents
  // vazio), então o valor exato só existe na Stripe.
  const PRECO_ANUAL_CENTAVOS = 79900;
  const PRECO_MENSAL_CENTAVOS = 7990;
  const brl = (centavos) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Olho: oculta os valores em reais (fica lembrado neste navegador).
  function valoresOcultos() {
    try { return localStorage.getItem("adm-ocultar-valores") === "1"; } catch { return false; }
  }

  function desenharReceita() {
    const ativos = estado.clientes.filter((c) => c.status !== "revoked" && diasAte(c.validoAte) >= 0);
    let anuais = 0;
    let mensais = 0;
    for (const c of ativos) {
      const p = planoDe(c).nome;
      if (p === "Anual") anuais += 1;
      else if (p === "Mensal") mensais += 1;
    }
    const arr = anuais * PRECO_ANUAL_CENTAVOS + mensais * PRECO_MENSAL_CENTAVOS * 12;
    const oculto = valoresOcultos();
    const dinheiro = (c) => (oculto ? "R$ •••••" : brl(c));

    const alvo = $("receita");
    alvo.innerHTML = "";
    const cab = el("div", "adm-receita-cab");
    cab.append(el("h2", "adm-receita-titulo", "Receita recorrente"));
    const olho = botao("", "adm-icone-bt adm-receita-olho", () => {
      try { localStorage.setItem("adm-ocultar-valores", oculto ? "0" : "1"); } catch { /* sem armazenamento */ }
      desenharReceita();
    });
    olho.setAttribute("aria-label", oculto ? "Mostrar valores" : "Ocultar valores");
    olho.title = oculto ? "Mostrar valores" : "Ocultar valores";
    olho.innerHTML = oculto
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3.2 3.8M6.5 7.6C4.3 9.2 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/></svg>';
    cab.append(olho);

    const grade = el("div", "adm-receita-grade");
    const itens = [
      ["ARR", dinheiro(arr), "por ano", true],
      ["MRR", dinheiro(Math.round(arr / 12)), "por mês", false],
      ["Assinantes", anuais + mensais, `${anuais} anuais · ${mensais} mensais`, false],
    ];
    for (const [rot, n, sub, destaque] of itens) {
      const k = el("div", `adm-kpi adm-kpi-neutro${destaque ? " adm-receita-arr" : ""}`);
      k.append(el("span", "adm-kpi-rot", rot), el("strong", "adm-kpi-n", n), el("span", "adm-kpi-sub", sub));
      grade.append(k);
    }
    alvo.append(cab, grade, el("p", "adm-receita-nota", "Estimativa pela tabela de preços atual."));
  }

  function desenharVisao() {
    desenharReceita();
    const cs = estado.clientes;
    const comLogin = cs.filter((c) => c.temLogin && c.status !== "revoked");
    const vencidos = comLogin.filter((c) => diasAte(c.validoAte) < 0);
    const vencendo = comLogin.filter((c) => {
      const r = diasAte(c.validoAte);
      return r >= 0 && r <= 30;
    });
    const bloqueados = cs.filter((c) => c.status === "revoked");
    const maquinas = cs.flatMap((c) => c.computadores || []).concat(estado.semAssinatura.flatMap((s) => s.computadores || []));
    const hoje = maquinas.filter((m) => Date.now() - ms(m.ultimoAcesso) < DIA).length;
    const videosMes = cs.reduce((s, c) => s + Number(c.videosMes || 0), 0);
    const chamadosAbertos = estado.chamados.filter((x) => x.status === "aberto" || x.status === "em_analise").length;

    const kp = $("kpis");
    kp.innerHTML = "";
    const itens = [
      ["Clientes ativos", comLogin.length - vencidos.length, "ok", `de ${cs.length} cadastrados`],
      ["Vencendo", vencendo.length, vencendo.length ? "atencao" : "neutro", "nos próximos 30 dias"],
      ["Vencidos", vencidos.length, vencidos.length ? "mal" : "neutro", bloqueados.length ? `${bloqueados.length} bloqueado(s)` : "nenhum bloqueado"],
      ["Online hoje", hoje, "ok", `de ${maquinas.length} computadores`],
      ["Vídeos este mês", videosMes, "neutro", "editados pelos clientes"],
    ];
    for (const [rot, n, tom, sub] of itens) {
      const k = el("div", `adm-vidro adm-kpi adm-kpi-${tom}`);
      k.append(el("span", "adm-kpi-rot", rot), el("strong", "adm-kpi-n", n), el("span", "adm-kpi-sub", sub));
      kp.appendChild(k);
    }

    const at = $("atencao");
    at.innerHTML = "";
    const pendencias = [];
    for (const c of vencidos) pendencias.push({ tom: "mal", titulo: c.email, texto: `Venceu ${dia(c.validoAte)}. Os computadores dele já não abrem.`, acao: "Ver ficha", id: c.id });
    for (const c of vencendo.filter((x) => diasAte(x.validoAte) <= 14)) {
      pendencias.push({ tom: "atencao", titulo: c.email, texto: `Vence em ${diasAte(c.validoAte)} dia(s). Bom momento para falar sobre renovação.`, acao: "Ver ficha", id: c.id });
    }
    for (const c of cs.filter((x) => !x.temLogin)) {
      pendencias.push({ tom: "espera", titulo: c.email, texto: "Dias reservados, mas sem login: ainda não valem.", acao: "Ver ficha", id: c.id });
    }
    if (estado.semAssinatura.length) {
      pendencias.push({ tom: "atencao", titulo: plural(estado.semAssinatura.length, "conta sem assinatura", "contas sem assinatura"), texto: "Têm login, mas o trial acabou ou nunca assinaram. Mande o link de assinatura.", acao: "Ver contas", filtro: "semassinatura" });
    }
    if (chamadosAbertos) {
      pendencias.push({ tom: "mal", titulo: plural(chamadosAbertos, "chamado aguardando", "chamados aguardando"), texto: "Clientes esperando resposta.", acao: "Abrir suporte", secao: "suporte" });
    }
    const bloqMaq = maquinas.filter((m) => m.bloqueadoEm).length;
    if (bloqMaq) {
      pendencias.push({ tom: "espera", titulo: plural(bloqMaq, "computador bloqueado", "computadores bloqueados"), texto: "Continuam bloqueados até você desbloquear.", acao: "Ver clientes", secao: "clientes" });
    }
    if (!pendencias.length) at.appendChild(el("p", "adm-vazio adm-vazio-ok", "Nada pendente. Tudo em dia."));
    for (const p of pendencias.slice(0, 12)) {
      const item = el("div", `adm-pend adm-pend-${p.tom}`);
      const corpo = el("div", "adm-pend-corpo");
      corpo.append(el("strong", "", p.titulo), el("span", "", p.texto));
      const bt = botao(p.acao, "adm-bt adm-bt-fraco adm-bt-sm", () => {
        if (p.secao) { location.hash = p.secao; return; }
        if (p.filtro) estado.filtro = p.filtro;
        else { estado.abertos.add(p.id); estado.filtro = "todos"; }
        location.hash = "clientes";
      });
      item.append(corpo, bt);
      at.appendChild(item);
    }

    const rc = $("recentes");
    rc.innerHTML = "";
    const recentes = cs
      .map((c) => ({ c, t: ms(ultimoAcessoDo(c)) }))
      .filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t)
      .slice(0, 6);
    if (!recentes.length) rc.appendChild(el("p", "adm-vazio", "Ninguém abriu o ATIVAVID ainda."));
    for (const { c, t } of recentes) {
      const linha = el("div", "adm-recente");
      linha.append(avatar(iniciais(c.email), "neutro", "adm-avatar-mini"));
      const txt = el("div", "adm-recente-txt");
      txt.append(el("strong", "", c.email), el("span", "", rel(new Date(t).toISOString())));
      linha.appendChild(txt);
      rc.appendChild(linha);
    }
  }

  // ============================================================ clientes

  const FILTROS = [
    ["todos", "Todos"],
    ["ativos", "Ativos"],
    ["vencendo", "Vencendo"],
    ["vencidos", "Vencidos"],
    ["bloqueados", "Bloqueados"],
    ["semlogin", "Sem login"],
    ["anual", "Anual"],
    ["mensal", "Mensal"],
    ["semassinatura", "Sem assinatura"],
  ];

  function desenharFiltros() {
    const alvo = $("filtros");
    alvo.innerHTML = "";
    for (const [k, rot] of FILTROS) {
      const b = botao(rot, "adm-chip-filtro", () => { estado.filtro = k; desenharFiltros(); desenharClientes(); });
      b.setAttribute("aria-pressed", estado.filtro === k ? "true" : "false");
      if (estado.filtro === k) b.classList.add("is-on");
      alvo.appendChild(b);
    }
  }

  function casaFiltro(c) {
    const s = situacaoDe(c);
    const p = planoDe(c);
    switch (estado.filtro) {
      case "ativos": return c.temLogin && (s.k === "ativa" || s.k === "vencendo");
      case "vencendo": return s.k === "vencendo";
      case "vencidos": return s.k === "vencida";
      case "bloqueados": return s.k === "bloqueada";
      case "semlogin": return s.k === "semlogin";
      case "anual": return p.nome === "Anual";
      case "mensal": return p.nome === "Mensal";
      case "semassinatura": return false;
      default: return true;
    }
  }

  function casaBusca(c, q) {
    if (!q) return true;
    const alvos = [c.email, ...(c.computadores || []).flatMap((m) => [m.label, m.host, m.osUser, m.emailNoPc, m.ultimoEmailAberto])];
    return alvos.some((v) => String(v || "").toLowerCase().includes(q));
  }

  function ordenar(lista) {
    const cmp = {
      vencimento: (a, b) => ms(a.validoAte) - ms(b.validoAte),
      acesso: (a, b) => ms(ultimoAcessoDo(b)) - ms(ultimoAcessoDo(a)),
      videos: (a, b) => Number(b.videosTotal || 0) - Number(a.videosTotal || 0),
      aulas: (a, b) => Number(b.aulasAssistidas || 0) - Number(a.aulasAssistidas || 0),
      nome: (a, b) => String(a.email).localeCompare(String(b.email), "pt-BR"),
    }[estado.ordem];
    return lista.slice().sort(cmp);
  }

  function desenharClientes() {
    const q = $("buscaGlobal").value.trim().toLowerCase();
    const alvo = $("listaClientes");
    const mostraSemAss = estado.filtro === "todos" || estado.filtro === "semassinatura";
    const lista = ordenar(estado.clientes.filter((c) => casaFiltro(c) && casaBusca(c, q)));
    const semAss = mostraSemAss
      ? estado.semAssinatura.filter((s) => casaBusca(s, q)).sort((a, b) => String(a.email).localeCompare(String(b.email), "pt-BR"))
      : [];
    alvo.innerHTML = "";
    if (!lista.length && !semAss.length) {
      alvo.appendChild(el("p", "adm-vazio", estado.clientes.length || estado.semAssinatura.length
        ? "Nada com este filtro ou busca."
        : "Nenhum cliente ainda. Use “Novo cliente” acima."));
      return;
    }
    for (const c of lista) alvo.appendChild(cartaoCliente(c));
    for (const s of semAss) alvo.appendChild(cartaoSemAssinatura(s));
  }

  // Planos que o painel oferece ao mandar um link. Cada um é um Payment Link
  // da Stripe. O preço de cada um TEM de estar em STRIPE_PRICE_ID (secret do
  // payments-webhook), senão o pagamento não libera o acesso.
  const PLANOS_VENDA = [
    { id: "anual", nome: "Anual", valor: "R$ 799,00 por ano", url: CHECKOUT_ANUAL },
    { id: "mensal", nome: "Mensal", valor: "R$ 79,90 por mês", url: CHECKOUT_MENSAL },
    { id: "mensal-antigo", nome: "Mensal antigo", valor: "R$ 59,00 por mês", url: "https://buy.stripe.com/9B68wQgFH6HP2Tk6oodwc02" },
  ];

  function linkAssinatura(email, plano) {
    const p = PLANOS_VENDA.find((x) => x.id === plano) || PLANOS_VENDA[0];
    return `${p.url}?prefilled_email=${encodeURIComponent(email)}`;
  }

  function abrirLinkAssinatura(email) {
    const corpo = el("div", "adm-form-modal");
    corpo.appendChild(el("p", "adm-ajuda", `Escolha o plano e mande o link para ${email}. Ele abre a compra no navegador, com o e-mail já preenchido. Assim que pagar, o acesso é liberado sozinho.`));
    const escolha = document.createElement("select");
    for (const p of PLANOS_VENDA) {
      const op = el("option", "", `${p.nome} · ${p.valor}`);
      op.value = p.id;
      escolha.appendChild(op);
    }
    const caixa = entrada("text", "", { readonly: "readonly" });
    caixa.className = "adm-link-caixa";
    caixa.addEventListener("focus", () => caixa.select());
    const atualizar = () => { caixa.value = linkAssinatura(email, escolha.value); };
    escolha.addEventListener("change", atualizar);
    atualizar();
    const copiar = botao("Copiar", "adm-bt adm-bt-forte adm-bt-sm", async () => {
      try {
        await navigator.clipboard.writeText(caixa.value);
        recado("Link copiado.", "ok");
      } catch {
        caixa.select();
        recado("Selecionei o link: copie com Ctrl+C.", "atencao");
      }
    });
    const wPlano = el("div", "adm-campo");
    wPlano.append(el("span", "", "Plano"), escolha);
    const wLink = el("div", "adm-campo");
    const linha = el("div", "adm-link-linha");
    linha.append(caixa, copiar);
    wLink.append(el("span", "", "Link"), linha);
    corpo.append(wPlano, wLink);
    abrirModal("Link de assinatura", corpo);
  }

  function cartaoSemAssinatura(s) {
    const restam = s.trialInicio ? Math.ceil((ms(s.trialInicio) + TRIAL_DIAS * DIA - Date.now()) / DIA) : null;
    const situacao = restam !== null && restam > 0
      ? { rot: `Trial · ${restam} dia${restam === 1 ? "" : "s"}`, tom: "atencao" }
      : { rot: s.trialInicio ? "Trial acabou" : "Sem assinatura", tom: "espera" };
    const art = el("article", "adm-vidro adm-cli adm-cli-espera");
    art.dataset.email = s.email;
    const topo = el("div", "adm-cli-topo");
    topo.append(avatar(iniciais(s.email), "espera"));
    const quem = el("div", "adm-cli-quem");
    quem.append(el("h3", "adm-cli-email", s.email));
    quem.append(el("p", "adm-cli-sub", `Conta criada ${dia(s.criadoEm)} · último login ${rel(s.ultimoLogin)}`));
    topo.appendChild(quem);
    const chips = el("div", "adm-cli-chips");
    const aulas = Number(s.aulasAssistidas || 0);
    chips.append(chip("Sem assinatura", "espera"), chip(situacao.rot, situacao.tom), chip(`${aulas}/${s.aulasTotal || 0} aulas`, aulas ? "ok" : "espera"));
    topo.appendChild(chips);
    art.appendChild(topo);

    const numeros = el("dl", "adm-numeros");
    const numero = (rot, valor, sub) => {
      const w = el("div", "adm-numero");
      w.append(el("dt", "", rot), el("dd", "", valor));
      if (sub) w.append(el("small", "", sub));
      return w;
    };
    const maqs = s.computadores || [];
    numeros.append(
      numero("Computadores", String(maqs.length), maqs.length ? "com essa conta" : "nenhum ainda"),
      numero("Vídeos", String(s.videosTotal || 0), `${s.videosMes || 0} este mês`),
      numero("Aulas", `${aulas}/${s.aulasTotal || 0}`, "assistidas"),
      numero("Último acesso", rel(s.ultimaAbertura || s.ultimoLogin), s.aberturasTotal ? `aberturas: ${s.aberturasTotal}` : "nunca abriu o app"),
    );
    art.appendChild(numeros);

    const aberto = estado.abertos.has(s.email);
    const bt = botao(aberto ? "Fechar ficha" : "Abrir ficha", "adm-expandir", () => {
      if (estado.abertos.has(s.email)) estado.abertos.delete(s.email); else estado.abertos.add(s.email);
      desenharClientes();
    });
    bt.setAttribute("aria-expanded", aberto ? "true" : "false");
    art.appendChild(bt);

    if (aberto) {
      const f = el("div", "adm-ficha");
      const col = el("section", "adm-ficha-col");
      col.appendChild(el("h4", "adm-ficha-titulo", "Liberar acesso"));
      col.appendChild(el("p", "adm-ajuda", "Libera esta conta com um prazo. Pagou por fora ou ganhou um tempo? Libere aqui."));
      let dias = 30;
      const prazo = el("div", "adm-seg adm-seg-mini");
      prazo.setAttribute("role", "radiogroup");
      for (const d of [30, 90, 365]) {
        const b = botao(d === 365 ? "1 ano" : `${d} dias`, d === 30 ? "is-on" : "", () => {
          dias = d;
          $$("button", prazo).forEach((x) => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-checked", x === b ? "true" : "false"); });
        });
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", d === 30 ? "true" : "false");
        prazo.appendChild(b);
      }
      const liberar = botao("Liberar acesso", "adm-bt adm-bt-forte adm-bt-sm", () => ocupado(liberar, async () => {
        const r = await licenca("grant_access", { p_email: s.email, p_days: dias, p_max_devices: 1 });
        recado(r.message || "Acesso liberado.", "ok");
        await carregar();
      }));
      const linkBt = botao("Enviar link de assinatura", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirLinkAssinatura(s.email));
      const excluir = botao("Excluir conta", "adm-bt adm-bt-perigo adm-bt-sm", null);
      excluir.addEventListener("click", () => doisToques(excluir, () => ocupado(excluir, async () => {
        const r = await fn({ acao: "apagar_conta", email: s.email });
        recado(r.message || "Conta apagada.", "ok");
        estado.abertos.delete(s.email);
        await carregar();
      })));
      const acoes = el("div", "adm-acoes");
      acoes.append(liberar, linkBt, excluir);
      col.append(prazo, acoes);
      f.appendChild(col);

      const colM = el("section", "adm-ficha-col");
      colM.appendChild(el("h4", "adm-ficha-titulo", maqs.length ? plural(maqs.length, "Computador", "Computadores") : "Nenhum computador"));
      for (const m of maqs) colM.appendChild(linhaMaquina(m, null));
      f.appendChild(colM);
      art.appendChild(f);
    }
    return art;
  }

  function cartaoCliente(c) {
    const s = situacaoDe(c);
    const p = planoDe(c);
    const maqs = c.computadores || [];
    const aberto = estado.abertos.has(c.id);

    const art = el("article", `adm-vidro adm-cli adm-cli-${s.tom}`);
    art.dataset.id = c.id;

    const topo = el("div", "adm-cli-topo");
    topo.append(avatar(iniciais(c.email), s.tom));
    const quem = el("div", "adm-cli-quem");
    quem.append(el("h3", "adm-cli-email", c.email));
    quem.append(el("p", "adm-cli-sub", `Cliente desde ${dia(c.clienteDesde)} · último acesso ${rel(ultimoAcessoDo(c))}`));
    topo.appendChild(quem);
    const chips = el("div", "adm-cli-chips");
    chips.append(chip(p.nome, "plano", "adm-chip-plano"), chip(s.rot, s.tom));
    const aulas = Number(c.aulasAssistidas || 0);
    const totalAulas = Number(c.aulasTotal || 0);
    chips.append(chip(`${aulas}/${totalAulas} aulas`, aulas ? "ok" : "espera"));
    topo.appendChild(chips);
    art.appendChild(topo);

    const val = el("div", "adm-validade");
    const legenda = el("div", "adm-validade-leg");
    legenda.append(el("span", "", c.temLogin ? `Vence ${dia(c.validoAte)}` : "Dias reservados, sem login"));
    const restam = p.restam;
    legenda.append(el("span", "adm-validade-dias", restam < 0 ? `venceu há ${-restam} dia(s)` : `${restam} dia(s) restantes`));
    val.appendChild(legenda);
    const trilho = el("div", "adm-trilho");
    const pct = p.total > 0 ? Math.max(0, Math.min(100, (restam / p.total) * 100)) : 0;
    const barra = el("span", `adm-barra-fill adm-fill-${s.tom}`);
    barra.style.width = `${pct}%`;
    trilho.appendChild(barra);
    val.appendChild(trilho);
    art.appendChild(val);

    const numeros = el("dl", "adm-numeros");
    const numero = (rot, valor, sub) => {
      const w = el("div", "adm-numero");
      w.append(el("dt", "", rot), el("dd", "", valor));
      if (sub) w.append(el("small", "", sub));
      return w;
    };
    numeros.append(
      numero("Computadores", `${maqs.length}/${c.maxComputadores || 1}`, maqs.length ? "ligados à conta" : "nenhum ainda"),
      numero("Vídeos", String(c.videosTotal || 0), `${c.videosMes || 0} este mês`),
      numero("Aulas", `${aulas}/${totalAulas}`, c.ultimaAula ? `última ${rel(c.ultimaAula)}` : "nenhuma assistida"),
      numero("Último acesso", rel(ultimoAcessoDo(c)), c.ultimaAbertura ? `aberturas: ${c.aberturasTotal || 0}` : "nunca abriu"),
    );
    art.appendChild(numeros);

    const bt = botao(aberto ? "Fechar ficha" : "Abrir ficha", "adm-expandir", () => {
      if (estado.abertos.has(c.id)) estado.abertos.delete(c.id); else estado.abertos.add(c.id);
      desenharClientes();
    });
    bt.setAttribute("aria-expanded", aberto ? "true" : "false");
    art.appendChild(bt);

    if (aberto) art.appendChild(fichaCliente(c));
    return art;
  }

  function fichaCliente(c) {
    const p = planoDe(c);
    const s = situacaoDe(c);
    const maqs = c.computadores || [];
    const f = el("div", "adm-ficha");

    const sub = el("section", "adm-ficha-col");
    sub.appendChild(el("h4", "adm-ficha-titulo", "Assinatura"));
    const dl = el("dl", "adm-ficha-dados");
    const linha = (rot, valor) => dl.append(el("dt", "", rot), el("dd", "", valor));
    linha("Plano", p.nome);
    linha("Situação", s.rot);
    linha("Início", dia(c.clienteDesde));
    linha("Vence em", dia(c.validoAte));
    linha("Computadores", `${maqs.length} de ${c.maxComputadores || 1} permitidos`);
    if (c.anotacao) linha("Anotação", c.anotacao);
    sub.appendChild(dl);

    if (!c.temLogin) {
      sub.appendChild(el("p", "adm-ficha-alerta",
        "Os dias estão reservados, mas só valem quando existir login com este e-mail."));
    }

    const acoes = el("div", "adm-acoes");
    const adicionar = botao("+ Dias", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirAdicionarDias(c));
    const editar = botao("Editar", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirEditarConta(c));
    const bloquear = botao(c.status === "revoked" ? "Já bloqueada" : "Bloquear acesso", "adm-bt adm-bt-fraco adm-bt-sm", null);
    bloquear.disabled = c.status === "revoked";
    bloquear.addEventListener("click", () => doisToques(bloquear, () => ocupado(bloquear, async () => {
      const r = await licenca("revoke_access", { p_email: c.email });
      recado(r.message || "Acesso bloqueado.", "ok");
      await carregar();
    })));
    const excluir = botao("Excluir cliente", "adm-bt adm-bt-perigo adm-bt-sm", null);
    excluir.addEventListener("click", () => doisToques(excluir, () => ocupado(excluir, async () => {
      const r = await fn({ acao: "apagar_conta", email: c.email });
      recado(r.message || "Conta apagada.", "ok");
      estado.abertos.delete(c.id);
      await carregar();
    })));
    acoes.append(adicionar, editar, bloquear, excluir);
    sub.appendChild(acoes);
    f.appendChild(sub);

    const aulasCol = el("section", "adm-ficha-col");
    aulasCol.appendChild(el("h4", "adm-ficha-titulo", `Aulas assistidas · ${c.aulasAssistidas || 0} de ${c.aulasTotal || 0}`));
    const lista = Array.isArray(c.aulas) ? c.aulas : [];
    if (!lista.length) {
      aulasCol.appendChild(el("p", "adm-ficha-vazia", "Nenhuma aula registrada ainda. Assim que o cliente assistir a uma, ela aparece aqui."));
    } else {
      const ul = el("ul", "adm-aulas-feitas");
      for (const a of lista.slice(0, 12)) {
        const li = el("li");
        li.append(el("span", "", a.titulo || "Aula"), el("small", "", dia(a.quando)));
        ul.appendChild(li);
      }
      aulasCol.appendChild(ul);
    }
    const dicas = el("p", "adm-ficha-dica", (c.aulasAssistidas || 0) === 0 && (c.videosTotal || 0) > 0
      ? "Editou vídeos mas nunca viu uma aula: vale indicar a aula de como montar o corte."
      : "");
    aulasCol.appendChild(dicas);
    f.appendChild(aulasCol);

    const col = el("section", "adm-ficha-col");
    col.appendChild(el("h4", "adm-ficha-titulo", maqs.length
      ? plural(maqs.length, "Computador ligado à conta", "Computadores ligados à conta")
      : "Nenhum computador ligado à conta"));
    if (!maqs.length) {
      col.appendChild(el("p", "adm-ficha-vazia", "Quando este cliente entrar num computador com a conta, ele aparece aqui."));
    }
    for (const m of maqs) col.appendChild(linhaMaquina(m, c));
    f.appendChild(col);

    return f;
  }

  function abrirAdicionarDias(c) {
    const corpo = el("div", "adm-form-modal");
    const restam = Math.max(0, diasAte(c.validoAte));
    corpo.append(el("p", "adm-ajuda", c.temLogin
      ? `Hoje vence ${dia(c.validoAte)}, com ${restam} dia(s) restantes. Os dias que você somar vêm depois do que ele já tem.`
      : "Este cliente ainda não tem login. Os dias somam, mas só valem depois que ele tiver conta."));
    const escolhido = { dias: 30 };
    const presets = el("div", "adm-seg adm-seg-mini");
    presets.setAttribute("role", "radiogroup");
    const destaque = (on) => { $$("button", presets).forEach((x) => { x.classList.toggle("is-on", x === on); x.setAttribute("aria-checked", x === on ? "true" : "false"); }); };
    for (const d of [7, 15, 30, 60, 90]) {
      const b = botao(`${d} dias`, d === 30 ? "is-on" : "", () => { escolhido.dias = d; destaque(b); resumo(); });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", d === 30 ? "true" : "false");
      presets.appendChild(b);
    }
    const resumoTxt = el("p", "adm-ajuda adm-ajuda-forte", "");
    const resumo = () => {
      const nova = restam + escolhido.dias;
      resumoTxt.textContent = `Nova validade: ${dia(new Date(Date.now() + nova * DIA).toISOString())} (${nova} dias a partir de hoje).`;
    };
    resumo();
    const salvar = botao("Adicionar dias", "adm-bt adm-bt-forte", null);
    salvar.addEventListener("click", () => ocupado(salvar, async () => {
      const total = Math.max(1, restam + escolhido.dias);
      const r = await licenca("grant_access", { p_email: c.email, p_days: total, p_max_devices: c.maxComputadores || 1 });
      fecharModal();
      recado(`Prazo estendido em ${escolhido.dias} dias.`, r.pendingSignup ? "atencao" : "ok");
      await carregar();
    }));
    corpo.append(presets, resumoTxt, botoes(salvar));
    abrirModal(`Adicionar dias · ${c.email}`, corpo);
  }

  function abrirEditarConta(c) {
    const corpo = el("form", "adm-form-modal");
    const maxi = entrada("number", c.maxComputadores || 1, { min: "1", max: "10", inputmode: "numeric" });
    const notas = el("textarea");
    notas.rows = 3;
    notas.maxLength = 400;
    notas.placeholder = "Ex.: cliente da turma de outubro, pediu desconto";
    notas.value = c.anotacao || "";
    const salvar = botao("Salvar", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    corpo.append(
      campo("Computadores permitidos", maxi, "Quantos computadores essa conta pode ligar ao mesmo tempo."),
      campo("Anotação", notas, "Só a equipe vê."),
      botoes(salvar)
    );
    corpo.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ocupado(salvar, async () => {
        const r = await rpc("ativavid_admin_editar_conta", {
          p_email: c.email,
          p_max: Math.max(1, Math.min(10, parseInt(maxi.value, 10) || 1)),
          p_notas: notas.value.trim(),
        });
        fecharModal();
        recado(r.message || "Conta atualizada.", "ok");
        await carregar();
      });
    });
    abrirModal(`Editar · ${c.email}`, corpo);
  }

  function cabecaMaquina(m, st) {
    const topo = el("div", "adm-maq-topo");
    const nome = el("div", "adm-maq-nome");
    nome.append(el("strong", "", m.label || m.host || shortId(m.deviceId)));
    nome.append(el("span", "adm-maq-id", [m.host, m.osUser].filter(Boolean).join(" · ") || shortId(m.deviceId)));
    topo.append(nome, chip(st.rot, st.tom));
    return topo;
  }

  function gradeMaquina(m, comTrial) {
    const grade = el("dl", "adm-maq-grade");
    const campo2 = (rot, valor) => grade.append(el("dt", "", rot), el("dd", "", valor));
    campo2("Último e-mail que abriu", ultimoEmailDo(m) || "—");
    campo2("Último acesso", rel(m.ultimoAcesso));
    campo2("Aberturas", String(m.aberturas || 0));
    campo2("Vídeos", `${m.videosMes || 0} este mês · ${m.videos || 0} no total`);
    if (comTrial) campo2("Início do trial", m.trialInicio ? dia(m.trialInicio) : "sem trial");
    else campo2("Primeira vez", dia(m.primeiraVez));
    if (m.bloqueadoEm) campo2("Bloqueado em", `${dia(m.bloqueadoEm)}${m.motivoBloqueio ? ` — ${m.motivoBloqueio}` : ""}`);
    return grade;
  }

  function linhaMaquina(m, c) {
    const st = estadoMaquina(m, c);
    const box = el("div", `adm-maq adm-maq-${st.tom}`);
    box.append(cabecaMaquina(m, st), gradeMaquina(m, false), botaoBloquearMaquina(m));
    return box;
  }

  function botaoBloquearMaquina(m) {
    const bloqueada = Boolean(m.bloqueadoEm);
    const bt = botao(bloqueada ? "Desbloquear" : "Bloquear computador",
      bloqueada ? "adm-bt adm-bt-fraco adm-bt-sm" : "adm-bt adm-bt-perigo adm-bt-sm", null);
    bt.addEventListener("click", () => doisToques(bt, () => ocupado(bt, async () => {
      const r = await fn({
        acao: "bloquear_maquina",
        device_id: m.deviceId,
        bloquear: !bloqueada,
        motivo: bloqueada ? null : "bloqueado pelo painel admin",
      });
      recado(r.message || (bloqueada ? "Computador liberado." : "Computador bloqueado."), "ok");
      await carregar();
    })));
    return bt;
  }

  function abrirNovoCliente() {
    const corpo = el("form", "adm-form-modal");
    const email = entrada("email", null, { placeholder: "cliente@email.com", autocapitalize: "off", spellcheck: "false", inputmode: "email" });
    const senha = entrada("text", null, { placeholder: "mínimo 6 caracteres", autocomplete: "off" });
    let dias = 365;
    const prazo = el("div", "adm-seg");
    prazo.setAttribute("role", "radiogroup");
    const marcar = (on) => $$("button", prazo).forEach((x) => { x.classList.toggle("is-on", x === on); x.setAttribute("aria-checked", x === on ? "true" : "false"); });
    for (const [d, rot] of [[30, "30 dias"], [90, "90 dias"], [365, "1 ano"]]) {
      const b = botao(rot, d === 365 ? "is-on" : "", () => { dias = d; marcar(b); });
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", d === 365 ? "true" : "false");
      prazo.appendChild(b);
    }
    const salvar = botao("Criar e liberar", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    const campoPrazo = el("div", "adm-campo");
    campoPrazo.append(el("span", "", "Acesso por"), prazo);
    corpo.append(
      campo("E-mail do cliente", email),
      campo("Senha provisória", senha, "O cliente entra com ela e troca depois em “Esqueci minha senha”."),
      campoPrazo,
      botoes(salvar)
    );
    corpo.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const e = email.value.trim().toLowerCase();
      const s = senha.value.trim();
      if (!e.includes("@")) return recado("Informe o e-mail do cliente.", "erro");
      if (s.length < 6) return recado("A senha provisória precisa de pelo menos 6 caracteres.", "erro");
      ocupado(salvar, async () => {
        const login = await fn({ acao: "criar_login", email: e, senha: s });
        const acesso = await licenca("grant_access", { p_email: e, p_days: dias, p_max_devices: 1 });
        fecharModal();
        recado(`${login.message || "Login pronto."} ${acesso.message || ""}`.trim(), acesso.pendingSignup ? "atencao" : "ok");
        await carregar();
      });
    });
    abrirModal("Novo cliente", corpo);
  }

  // ============================================================ academy (a área do aluno, com a sua conta)

  function abrirAcademy() {
    const f = $("academyFrame");
    if (!f.getAttribute("src")) f.src = "/aulas?painel=1";
  }

  // ============================================================ cartão de aula (prévia)

  function cartaoAluno(a) {
    const card = el("article", "adm-vidro adm-aluno-card");
    const capa = el("div", "adm-aluno-capa");
    if (a.youtubeId) {
      const img = document.createElement("img");
      img.src = `https://i.ytimg.com/vi/${encodeURIComponent(a.youtubeId)}/mqdefault.jpg`;
      img.alt = "";
      img.loading = "lazy";
      capa.appendChild(img);
    }
    const corpo = el("div", "adm-aluno-corpo");
    corpo.append(el("h4", "", a.titulo || "Aula"));
    if (a.descricao) corpo.append(el("p", "", a.descricao));
    const link = el("a", "adm-bt adm-bt-forte adm-bt-sm adm-aluno-assistir", "Assistir");
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(a.youtubeId || "")}`;
    link.target = "_blank";
    link.rel = "noopener";
    corpo.appendChild(link);
    card.append(capa, corpo);
    return card;
  }

  // ============================================================ suporte

  // Abas fixas em cima da lista; o resto fica no botão Filtros.
  // Em cima: aberto ou resolvido. Dentro de "Em aberto": com quem está a vez.
  const ABAS_CHAMADO = [
    ["ativos", "Em aberto"],
    ["resolvido", "Resolvidos"],
  ];
  const SUBABAS_CHAMADO = [
    ["equipe", "Com a equipe", "Novos e em atendimento: a equipe precisa agir"],
    ["cliente", "Com o cliente", "Aguardando a resposta do cliente"],
  ];
  const DENTRO_DE_ABERTO = ["ativos", "equipe", "cliente"];
  const MAIS_FILTROS = [
    ["todos", "Todos"],
    ["aberto", "Novos"],
    ["em_analise", "Em atendimento"],
  ];
  const ANEXO_TIPOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const ANEXO_MAX_BYTES = 8 * 1024 * 1024;
  const ANEXO_MAX_QTD = 4;
  let anexosResposta = [];

  async function carregarChamados(silencioso) {
    const r = await rpc("ativavid_admin_lista_chamados", { p_status: null });
    estado.chamados = Array.isArray(r.chamados) ? r.chamados : [];
    const abertos = estado.chamados.filter((x) => x.status === "aberto" || x.status === "em_analise").length;
    const n = $("navSuporte");
    n.textContent = String(abertos);
    n.hidden = abertos === 0;
    const sino = $("sinoBadge");
    sino.textContent = abertos > 9 ? "9+" : String(abertos);
    sino.hidden = abertos === 0;
    $("btSino").setAttribute("aria-label", abertos ? plural(abertos, "chamado aguardando", "chamados aguardando") : "Avisos");
    desenharSino();
    if (estado.secao === "suporte") desenharSuporte();
    if (!silencioso && estado.papel === "admin") desenharVisao();
  }

  function desenharSino() {
    const lista = $("sinoLista");
    lista.innerHTML = "";
    const pendentes = estado.chamados.filter((x) => x.status === "aberto" || x.status === "em_analise").slice(0, 5);
    if (!pendentes.length) {
      lista.appendChild(el("p", "adm-sino-vazio", "Nenhum chamado esperando resposta."));
      return;
    }
    for (const x of pendentes) {
      const b = botao("", "adm-sino-item", () => {
        fecharMenus();
        location.hash = "suporte";
        abrirChamado(x.id);
      });
      b.append(el("strong", "", `#${x.id} · ${x.assunto}`), el("span", "", `${x.email} · ${rel(x.atualizado_em)}`));
      lista.appendChild(b);
    }
  }

  function filtraChamados() {
    const f = estado.filtroChamado;
    const termo = String(estado.buscaChamado || "").trim().toLowerCase().replace(/^#/, "");
    return estado.chamados.filter((x) => {
      if (!casaFiltro(x, f)) return false;
      if (!termo) return true;
      return [String(x.id), x.email, x.assunto, x.descricao, nomeDoCliente(x.email)]
        .some((v) => String(v || "").toLowerCase().includes(termo));
    }).sort((a, b) => ms(b.atualizado_em) - ms(a.atualizado_em));
  }

  function casaFiltro(x, f) {
    if (f === "todos") return true;
    if (f === "ativos") return x.status !== "resolvido";
    if (f === "equipe") return x.status === "aberto" || x.status === "em_analise";
    if (f === "cliente") return x.status === "aguardando_cliente";
    return x.status === f;
  }

  function contaFiltro(k) {
    return estado.chamados.filter((x) => casaFiltro(x, k)).length;
  }

  // Nome legível a partir do e-mail (o chamado só guarda o e-mail).
  function nomeDoCliente(email) {
    const base = String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
    return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Cliente";
  }

  function desenharSuporte() {
    const filtros = $("filtrosSuporte");
    filtros.innerHTML = "";
    const f = estado.filtroChamado;
    const linha1 = el("div", "adm-sup-abas");
    for (const [k, rot] of ABAS_CHAMADO) {
      const on = k === "ativos" ? DENTRO_DE_ABERTO.includes(f) : f === k;
      const b = botao("", `adm-sup-aba${on ? " is-on" : ""}`, () => { estado.filtroChamado = k; desenharSuporte(); });
      b.append(el("span", "", rot), el("em", "adm-sup-n", contaFiltro(k)));
      b.setAttribute("aria-pressed", on ? "true" : "false");
      linha1.appendChild(b);
    }
    filtros.appendChild(linha1);
    if (DENTRO_DE_ABERTO.includes(f)) {
      const linha2 = el("div", "adm-sup-abas adm-sup-subabas");
      for (const [k, rot, dica] of SUBABAS_CHAMADO) {
        // clicar de novo na mesma volta para "todos em aberto"
        const b = botao("", `adm-sup-aba${f === k ? " is-on" : ""}`, () => {
          estado.filtroChamado = estado.filtroChamado === k ? "ativos" : k;
          desenharSuporte();
        });
        b.title = dica;
        b.append(el("span", "", rot), el("em", "adm-sup-n", contaFiltro(k)));
        b.setAttribute("aria-pressed", f === k ? "true" : "false");
        linha2.appendChild(b);
      }
      filtros.appendChild(linha2);
    }
    // botão Filtros: abre os filtros que não têm aba
    const extra = MAIS_FILTROS.find(([k]) => k === estado.filtroChamado);
    const caixa = el("div", "adm-sup-mais");
    const menu = el("div", "adm-sup-menu");
    menu.hidden = true;
    const abrir = botao("", `adm-sup-aba adm-sup-filtrar${extra ? " is-on" : ""}`, (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    abrir.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    abrir.append(el("span", "", extra ? extra[1] : "Filtros"));
    abrir.setAttribute("aria-haspopup", "true");
    for (const [k, rot] of MAIS_FILTROS) {
      const it = botao("", `adm-sup-menu-item${estado.filtroChamado === k ? " is-on" : ""}`, () => {
        estado.filtroChamado = k;
        desenharSuporte();
      });
      it.append(el("span", "", rot), el("em", "adm-sup-n", contaFiltro(k)));
      menu.appendChild(it);
    }
    caixa.append(abrir, menu);
    $("filtrosMais").replaceChildren(caixa);

    const alvo = $("listaChamados");
    alvo.innerHTML = "";
    const lista = filtraChamados();
    if (!lista.length) {
      alvo.appendChild(el("p", "adm-sup-lista-vazia", estado.chamados.length
        ? "Nada neste filtro."
        : "Nenhum chamado ainda. Quando um cliente abrir um, ele aparece aqui."));
      return;
    }
    for (const x of lista) alvo.appendChild(itemChamado(x));
  }

  function itemChamado(x) {
    const st = STATUS_CHAMADO[x.status] || { rot: x.status, tom: "neutro" };
    const it = el("button", `adm-sup-item${estado.chamadoAberto === x.id ? " is-on" : ""}`);
    it.type = "button";
    const meio = el("div", "adm-sup-item-meio");
    const l1 = el("div", "adm-sup-item-l1");
    l1.append(el("strong", "", nomeDoCliente(x.email)), el("span", "adm-sup-item-hora", rel(x.atualizado_em)));
    const l2 = el("div", "adm-sup-item-l2");
    l2.append(el("span", "adm-sup-item-num", `#${x.id}`), el("span", "adm-sup-item-assunto", x.assunto));
    const l3 = el("p", "adm-sup-item-desc", x.descricao || x.ultima || "");
    meio.append(l1, l2, l3, chip(st.rot, st.tom));
    it.append(el("span", `adm-avatar adm-avatar-mini adm-avatar-${st.tom}`, iniciais(x.email)), meio);
    it.addEventListener("click", () => abrirChamado(x.id));
    return it;
  }

  function horaCurta(iso) {
    const t = ms(iso);
    if (!t) return "";
    return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function rotuloDia(iso) {
    const d = new Date(ms(iso));
    const igual = (a, b) => a.toDateString() === b.toDateString();
    if (igual(d, new Date())) return "Hoje";
    if (igual(d, new Date(Date.now() - DIA))) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function bolhaAdmin(m) {
    const eu = m.autor === "admin";
    const b = el("div", `adm-sup-bolha ${eu ? "is-eu" : "is-cliente"}`);
    if (m.anexos && m.anexos.length) {
      const fotos = el("div", "adm-sup-fotos");
      for (const a of m.anexos) {
        const link = el("a", "adm-sup-foto");
        link.target = "_blank";
        link.rel = "noopener";
        const img = document.createElement("img");
        img.alt = a.nome || "Print";
        img.loading = "lazy";
        link.append(img);
        fotos.append(link);
        // bucket privado: link assinado, válido por 1 hora
        sb.storage.from("chamados").createSignedUrl(a.path, 3600).then(({ data }) => {
          if (!data) return;
          img.src = data.signedUrl;
          link.href = data.signedUrl;
        });
      }
      b.append(fotos);
    }
    if (m.texto) b.append(el("p", "adm-sup-bolha-texto", m.texto));
    b.append(el("span", "adm-sup-bolha-hora", `${eu ? "Equipe" : "Cliente"} · ${horaCurta(m.criado_em)}`));
    return b;
  }

  function mostrarConversa(aberta) {
    $("suporteGrade").classList.toggle("com-conversa", aberta);
    $("conversaVazia").hidden = aberta;
    $("conversaCab").hidden = !aberta;
    $("conversaMensagens").hidden = !aberta;
    $("formResposta").hidden = !aberta;
  }

  // aoVivo: atualização vinda do tempo real ou da troca de status; não apaga o
  // rascunho nem os prints escolhidos, e só desce se já estava no fim.
  async function abrirChamado(id, aoVivo = false) {
    estado.chamadoAberto = id;
    if (!aoVivo) desenharSuporte();
    const r = await rpc("ativavid_admin_chamado_completo", { p_id: id });
    const ch = r.chamado;
    mostrarConversa(true);
    $("conversaAvatar").textContent = iniciais(ch.email);
    $("conversaAssunto").textContent = `#${ch.id} · ${ch.assunto}`;
    $("conversaQuem").textContent = `${nomeDoCliente(ch.email)} · ${ch.email} · aberto em ${dia(ch.criado_em)}`;
    const msgs = $("conversaMensagens");
    const pertoDoFim = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
    msgs.innerHTML = "";
    let diaAnterior = "";
    for (const m of r.mensagens || []) {
      const rotulo = rotuloDia(m.criado_em);
      if (rotulo !== diaAnterior) {
        msgs.appendChild(el("div", "adm-sup-dia", rotulo));
        diaAnterior = rotulo;
      }
      msgs.appendChild(bolhaAdmin(m));
    }
    if (!aoVivo || pertoDoFim) msgs.scrollTop = msgs.scrollHeight;
    $("statusResposta").value = ch.status;
    if (!aoVivo) {
      $("textoResposta").value = "";
      $("textoResposta").style.height = "";
      anexosResposta = [];
      desenharAnexosResposta();
      $("textoResposta").focus();
    }
    $("conversa").dataset.id = String(id);
  }

  function fecharConversa() {
    estado.chamadoAberto = null;
    delete $("conversa").dataset.id;
    mostrarConversa(false);
    desenharSuporte();
  }

  // Status é ação própria: muda na hora, com ou sem mensagem.
  async function mudarStatus(ev) {
    const id = Number($("conversa").dataset.id);
    const sel = ev.target;
    if (!id) return;
    sel.disabled = true;
    try {
      await rpc("ativavid_admin_status", { p_id: id, p_status: sel.value });
      await carregarChamados(true);
      await abrirChamado(id, true);
      recado(`Status alterado para “${STATUS_CHAMADO[sel.value].rot}”. O cliente vê na conta dele.`, "ok");
    } catch (e) {
      recado((e && e.message) || "Não consegui mudar o status.", "erro");
    } finally {
      sel.disabled = false;
    }
  }

  function adicionarAnexosResposta(arquivos) {
    for (const f of Array.from(arquivos)) {
      if (!ANEXO_TIPOS.includes(f.type)) return recado(`"${f.name}" não é imagem. Envie PNG, JPG, WebP ou GIF.`, "atencao");
      if (f.size > ANEXO_MAX_BYTES) return recado(`"${f.name}" passa de 8 MB.`, "atencao");
      if (anexosResposta.length >= ANEXO_MAX_QTD) return recado("No máximo 4 imagens por mensagem.", "atencao");
      anexosResposta.push(f);
    }
    desenharAnexosResposta();
  }

  function desenharAnexosResposta() {
    const ul = $("respostaAnexosAdm");
    ul.innerHTML = "";
    anexosResposta.forEach((f, i) => {
      const item = el("li", "adm-sup-anexo");
      const tirar = botao("Remover", "adm-sup-anexo-x", () => {
        anexosResposta.splice(i, 1);
        desenharAnexosResposta();
      });
      item.append(el("span", "", f.name), tirar);
      ul.appendChild(item);
    });
  }

  // Prints da equipe ficam na pasta do chamado: <id>/<arquivo>.
  async function enviarAnexosAdmin(chamadoId, mensagemId, arquivos) {
    for (const f of arquivos) {
      const seguro = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80) || "print.png";
      const caminho = `${chamadoId}/${Date.now()}-${seguro}`;
      const { error } = await sb.storage.from("chamados").upload(caminho, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(`Não consegui enviar "${f.name}". Tente de novo.`);
      await rpc("ativavid_admin_anexar", {
        p_chamado_id: chamadoId,
        p_mensagem_id: mensagemId,
        p_path: caminho,
        p_nome: f.name,
        p_tipo: f.type,
        p_tamanho: f.size,
      });
    }
  }

  async function responder(ev) {
    ev.preventDefault();
    const id = Number($("conversa").dataset.id);
    const texto = $("textoResposta").value.trim();
    if (!id) return;
    if (!texto) return recado(anexosResposta.length ? "Escreva uma mensagem junto com o print." : "Escreva a resposta antes de enviar.", "atencao");
    await ocupado($("btResponder"), async () => {
      const r = await rpc("ativavid_admin_responder", { p_id: id, p_texto: texto });
      await enviarAnexosAdmin(id, r.mensagemId, anexosResposta);
      $("textoResposta").value = "";
      $("textoResposta").style.height = "";
      anexosResposta = [];
      desenharAnexosResposta();
      await carregarChamados(true);
      await abrirChamado(id, true);
      const msgs = $("conversaMensagens");
      msgs.scrollTop = msgs.scrollHeight;
    });
  }

  $("buscaChamados").addEventListener("input", (e) => {
    estado.buscaChamado = e.target.value;
    desenharSuporte();
  });
  // clicar fora fecha o menu de filtros
  document.addEventListener("click", () => {
    const m = document.querySelector(".adm-sup-menu");
    if (m) m.hidden = true;
  });
  $("arquivosResposta").addEventListener("change", (e) => {
    adicionarAnexosResposta(e.target.files);
    e.target.value = "";
  });
  // Enter envia; Shift+Enter quebra a linha. O campo cresce com o texto.
  $("textoResposta").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("formResposta").requestSubmit();
    }
  });
  $("textoResposta").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  });

  // Tempo real: chamado, mensagem ou print novo atualiza a lista e a conversa aberta.
  let suporteAoVivo = null;
  let suporteAgendado = null;

  // A grade ocupa exatamente o que sobra da tela abaixo dela.
  function ajustarAlturaSuporte() {
    const grade = $("suporteGrade");
    if ($("secSuporte").hidden) return;
    const topo = grade.getBoundingClientRect().top;
    grade.style.height = `${Math.max(380, window.innerHeight - topo - 16)}px`;
  }
  window.addEventListener("resize", ajustarAlturaSuporte);

  function ouvirSuporte() {
    if (suporteAoVivo) return;
    const quando = { event: "*", schema: "public" };
    const agendar = () => {
      clearTimeout(suporteAgendado);
      suporteAgendado = setTimeout(async () => {
        try {
          await carregarChamados(true);
          if (estado.chamadoAberto) await abrirChamado(estado.chamadoAberto, true);
        } catch { /* a próxima mudança tenta de novo */ }
      }, 300);
    };
    suporteAoVivo = sb.channel("suporte-equipe")
      .on("postgres_changes", { ...quando, table: "chamados" }, agendar)
      .on("postgres_changes", { ...quando, table: "chamados_mensagens" }, agendar)
      .on("postgres_changes", { ...quando, table: "chamados_anexos" }, agendar)
      .subscribe();
  }

  // ============================================================ equipe

  async function carregarEquipe() {
    const r = await rpc("ativavid_admin_equipe");
    estado.equipe = Array.isArray(r.equipe) ? r.equipe : [];
    desenharEquipe();
  }

  function desenharEquipe() {
    const alvo = $("listaEquipe");
    alvo.innerHTML = "";
    if (!estado.equipe.length) {
      alvo.appendChild(el("p", "adm-vazio", "Ninguém na equipe ainda."));
      return;
    }
    const ordenada = estado.equipe.slice().sort((a, b) => (a.papel === "admin" ? -1 : 1) - (b.papel === "admin" ? -1 : 1) || String(a.email).localeCompare(String(b.email)));
    for (const p of ordenada) {
      const eu = p.email.toLowerCase() === estado.email.toLowerCase();
      const cartao = el("article", "adm-vidro adm-membro");
      const topo = el("div", "adm-membro-topo");
      topo.append(avatar(iniciais(p.label || p.email), p.papel === "admin" ? "ok" : "neutro"));
      const quem2 = el("div", "adm-membro-quem");
      quem2.append(el("strong", "", p.label && p.label !== "owner" ? p.label : p.email));
      quem2.append(el("span", "adm-membro-mail", p.email));
      topo.appendChild(quem2);
      const tags = el("div", "adm-membro-tags");
      tags.append(chip(p.papel === "admin" ? "Admin" : "Suporte", p.papel === "admin" ? "ok" : "plano"));
      if (eu) tags.append(chip("Você", "neutro"));
      if (!p.temLogin) tags.append(chip("Sem login ainda", "espera"));
      topo.appendChild(tags);
      cartao.appendChild(topo);

      const acoes = el("div", "adm-acoes adm-membro-acoes");
      const papelSel = el("select", "adm-papel-sel");
      papelSel.setAttribute("aria-label", `Papel de ${p.email}`);
      papelSel.append(new Option("Admin", "admin"), new Option("Suporte", "suporte"));
      papelSel.value = p.papel;
      papelSel.disabled = eu;
      papelSel.addEventListener("change", () => ocupado(papelSel, async () => {
        const r = await rpc("ativavid_admin_equipe_salvar", { p_email: p.email, p_papel: papelSel.value, p_label: null });
        recado(r.message || "Papel atualizado.", "ok");
        await carregarEquipe();
      }));
      const remover = botao("Remover", "adm-bt adm-bt-perigo adm-bt-sm", null);
      remover.disabled = eu;
      remover.addEventListener("click", () => doisToques(remover, () => ocupado(remover, async () => {
        const r = await rpc("ativavid_admin_equipe_remover", { p_email: p.email });
        recado(r.message || "Removido da equipe.", "ok");
        await carregarEquipe();
      })));
      acoes.append(papelSel, remover);
      cartao.appendChild(acoes);
      alvo.appendChild(cartao);
    }
  }

  function abrirNovoMembro() {
    const corpo = el("form", "adm-form-modal");
    const email = entrada("email", null, { placeholder: "nome@ativavid.com", autocapitalize: "off", spellcheck: "false", inputmode: "email" });
    const nome = entrada("text", null, { maxlength: "60", placeholder: "Ex.: Ice" });
    const senha = entrada("text", null, { autocomplete: "off", placeholder: "só se ainda não tem login" });
    let papel = "suporte";

    const cards = el("div", "adm-papeis");
    cards.setAttribute("role", "radiogroup");
    const marcar = (valor) => {
      papel = valor;
      $$(".adm-papel-card", cards).forEach((x) => {
        const on = x.dataset.papel === valor;
        x.classList.toggle("is-on", on);
        x.setAttribute("aria-checked", on ? "true" : "false");
      });
    };
    const opcoes = [
      ["suporte", "Suporte", "Atende os chamados dos clientes. Não vê nem muda assinaturas, aulas ou equipe."],
      ["admin", "Admin", "Vê e faz tudo: clientes, prazos, aulas, suporte e a própria equipe."],
    ];
    for (const [valor, rot, desc] of opcoes) {
      const c = botao("", "adm-papel-card", () => marcar(valor));
      c.dataset.papel = valor;
      c.setAttribute("role", "radio");
      c.append(el("strong", "", rot), el("span", "", desc));
      cards.appendChild(c);
    }
    marcar("suporte");

    const salvar = botao("Adicionar à equipe", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    const campoPapel = el("div", "adm-campo");
    campoPapel.append(el("span", "", "Papel"), cards);
    corpo.append(
      campo("E-mail da pessoa", email),
      campo("Nome (opcional)", nome, "Aparece no lugar do e-mail na lista da equipe."),
      campo("Senha provisória", senha, "Só se a pessoa ainda não tem login no ATIVAVID. Ela troca a senha depois."),
      campoPapel,
      botoes(salvar)
    );
    corpo.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const e = email.value.trim().toLowerCase();
      if (!e.includes("@")) return recado("Informe o e-mail da pessoa.", "erro");
      const s = senha.value.trim();
      if (s && s.length < 6) return recado("A senha provisória precisa de pelo menos 6 caracteres.", "erro");
      ocupado(salvar, async () => {
        let aviso = "";
        if (s) {
          const login = await fn({ acao: "criar_login", email: e, senha: s });
          aviso = login.created ? "Login criado. " : "A conta já existia. ";
        }
        const r = await rpc("ativavid_admin_equipe_salvar", { p_email: e, p_papel: papel, p_label: nome.value.trim() || null });
        fecharModal();
        recado(`${aviso}${r.message || "Equipe atualizada."}`, "ok");
        await carregarEquipe();
      });
    });
    abrirModal("Adicionar pessoa à equipe", corpo);
  }

  // ============================================================ aulas

  function youtubeId(texto) {
    const s = String(texto || "").trim();
    const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return "";
  }

  async function carregarAulas() {
    const [r, m] = await Promise.all([
      rpc("ativavid_admin_aulas", { p_action: "list" }),
      rpc("ativavid_admin_modulos", { p_action: "list" }),
    ]);
    estado.aulas = Array.isArray(r.aulas) ? r.aulas : [];
    estado.modulos = Array.isArray(m.modulos) ? m.modulos : [];
    desenharAulas();
  }

  // ---------------------------------------------------------------- módulos

  async function operarModulo(args, ok) {
    await rpc("ativavid_admin_modulos", args);
    await carregarAulas();
    if (ok) recado(ok, "ok");
  }

  function desenharModulos() {
    const alvo = $("painelModulos");
    alvo.innerHTML = "";
    const cab = el("div", "adm-modulos-cab");
    const titulo = el("div", "");
    titulo.append(el("h3", "adm-modulos-titulo", "Módulos"), el("p", "adm-ajuda", "Organizam as aulas. O cliente vê os módulos nesta ordem, de cima para baixo."));
    const novo = botao("Novo módulo", "adm-bt adm-bt-forte adm-bt-sm", () => abrirNomeModulo("Novo módulo", "", (nome) => operarModulo({ p_action: "create", p_nome: nome }, "Módulo criado.")));
    cab.append(titulo, novo);
    alvo.appendChild(cab);

    if (!estado.modulos.length) {
      alvo.appendChild(el("p", "adm-vazio", "Nenhum módulo ainda. Crie o primeiro para organizar as aulas."));
      return;
    }
    const lista = el("div", "adm-modulos-lista");
    estado.modulos.forEach((m, i) => {
      const linha = el("div", "adm-modulo");
      const info = el("div", "adm-modulo-info");
      info.append(el("span", "adm-modulo-posicao", String(i + 1)), el("strong", "adm-modulo-nome", m.nome), el("span", "adm-modulo-n", plural(m.aulas, "aula", "aulas")));
      const acoes = el("div", "adm-acoes");
      const subir = botao("↑", "adm-bt adm-bt-fraco adm-bt-sm", () => operarModulo({ p_action: "move", p_nome: m.nome, p_direcao: "cima" }, ""));
      const descer = botao("↓", "adm-bt adm-bt-fraco adm-bt-sm", () => operarModulo({ p_action: "move", p_nome: m.nome, p_direcao: "baixo" }, ""));
      subir.setAttribute("aria-label", `Subir ${m.nome}`);
      descer.setAttribute("aria-label", `Descer ${m.nome}`);
      subir.disabled = i === 0;
      descer.disabled = i === estado.modulos.length - 1;
      const renomear = botao("Renomear", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirNomeModulo("Renomear módulo", m.nome, (nome) => operarModulo({ p_action: "rename", p_nome: m.nome, p_novo_nome: nome }, "Módulo renomeado.")));
      const excluir = botao("Excluir", "adm-bt adm-bt-perigo adm-bt-sm", null);
      excluir.addEventListener("click", () => doisToques(excluir, () => excluirModulo(m)));
      acoes.append(subir, descer, renomear, excluir);
      linha.append(info, acoes);
      lista.appendChild(linha);
    });
    alvo.appendChild(lista);
  }

  function abrirNomeModulo(titulo, valor, onSalvar) {
    const form = el("form", "adm-form-modal");
    const input = entrada("text", valor, { maxlength: "60", required: "required", placeholder: "Ex.: Começando, Edição, Conta" });
    const salvar = botao("Salvar", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    form.append(
      campo("Nome do módulo", input, "É como o cliente vê o módulo na área de aulas."),
      botoes(salvar, botao("Cancelar", "adm-bt adm-bt-fraco", () => fecharModal())),
    );
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const nome = input.value.trim();
      if (!nome) return recado("Dê um nome ao módulo.", "erro");
      ocupado(salvar, async () => {
        await onSalvar(nome);
        fecharModal();
      });
    });
    abrirModal(titulo, form);
  }

  function excluirModulo(m) {
    if (m.aulas > 0) return abrirExcluirComDestino(m);
    return operarModulo({ p_action: "delete", p_nome: m.nome }, "Módulo excluído.");
  }

  // Módulo com aulas: as aulas precisam ir para outro módulo antes de sair.
  function abrirExcluirComDestino(m) {
    const outros = estado.modulos.filter((x) => x.nome !== m.nome);
    if (!outros.length) return recado("Crie outro módulo antes: as aulas desse precisam de para onde ir.", "atencao");
    const form = el("form", "adm-form-modal");
    form.append(el("p", "adm-ajuda", `O módulo “${m.nome}” tem ${plural(m.aulas, "aula", "aulas")}. Escolha para qual módulo elas vão. Depois o módulo é excluído.`));
    const sel = document.createElement("select");
    for (const x of outros) {
      const op = el("option", "", x.nome);
      op.value = x.nome;
      sel.appendChild(op);
    }
    const confirmar = botao("Mover aulas e excluir", "adm-bt adm-bt-perigo", null);
    confirmar.type = "submit";
    form.append(
      campo("Mover as aulas para", sel),
      botoes(confirmar, botao("Cancelar", "adm-bt adm-bt-fraco", () => fecharModal())),
    );
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ocupado(confirmar, async () => {
        await rpc("ativavid_admin_modulos", { p_action: "delete", p_nome: m.nome, p_destino: sel.value });
        fecharModal();
        await carregarAulas();
        recado(`Módulo excluído. As aulas foram para “${sel.value}”.`, "ok");
      });
    });
    abrirModal("Excluir módulo", form);
  }

  // ---------------------------------------------------------------- aulas

  function desenharAulas() {
    desenharModulos();
    const alvo = $("listaAulas");
    alvo.innerHTML = "";
    if (!estado.aulas.length) {
      alvo.appendChild(el("p", "adm-vazio", "Nenhuma aula cadastrada ainda. Use “Nova aula” para começar."));
      return;
    }
    // aulas agrupadas pelo módulo, na ordem dos módulos
    const grupos = new Map(estado.modulos.map((m) => [m.nome, []]));
    const soltas = [];
    for (const a of estado.aulas) {
      const k = a.secao || "Geral";
      if (grupos.has(k)) grupos.get(k).push(a);
      else soltas.push(a);
    }
    const porOrdem = (x, y) => (x.ordem ?? 100) - (y.ordem ?? 100);
    for (const m of estado.modulos) {
      alvo.appendChild(el("h3", "adm-aulas-modulo", m.nome));
      const itens = grupos.get(m.nome).sort(porOrdem);
      if (!itens.length) alvo.appendChild(el("p", "adm-ajuda", "Nenhuma aula neste módulo ainda."));
      for (const a of itens) alvo.appendChild(cartaoAulaAdmin(a));
    }
    if (soltas.length) {
      alvo.appendChild(el("h3", "adm-aulas-modulo", "Sem módulo"));
      for (const a of soltas.sort(porOrdem)) alvo.appendChild(cartaoAulaAdmin(a));
    }
  }

  function cartaoAulaAdmin(a) {
    const linha = el("article", `adm-vidro adm-aula ${a.ativo === false ? "is-oculta" : ""}`);
    const capa = el("div", "adm-aula-capa");
    if (a.youtubeId) {
      const img = document.createElement("img");
      img.src = `https://i.ytimg.com/vi/${encodeURIComponent(a.youtubeId)}/mqdefault.jpg`;
      img.alt = "";
      img.loading = "lazy";
      capa.appendChild(img);
    }
    const corpo = el("div", "adm-aula-corpo");
    corpo.append(el("span", "adm-aula-secao", a.secao || "Geral"));
    corpo.append(el("h3", "", a.titulo || "Sem título"));
    if (a.descricao) corpo.append(el("p", "", a.descricao));
    const meta = el("p", "adm-aula-meta");
    meta.append(el("span", "", `Posição ${a.ordem ?? 100}`));
    meta.append(el("span", a.ativo === false ? "adm-aula-oculta" : "adm-aula-visivel", a.ativo === false ? "Oculta: o cliente não vê" : "Visível para o cliente"));
    corpo.appendChild(meta);
    const acoes = el("div", "adm-acoes");
    acoes.append(
      botao("Editar", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirFormAula(a)),
      botao("Ver como o cliente vê", "adm-bt adm-bt-fraco adm-bt-sm", () => abrirPreviaAula(a)),
    );
    corpo.appendChild(acoes);
    linha.append(capa, corpo);
    return linha;
  }

  function abrirPreviaAula(a) {
    const corpo = el("div", "adm-form-modal");
    corpo.appendChild(el("p", "adm-ajuda", "É assim que o cliente vê esta aula na área de aulas."));
    corpo.appendChild(cartaoAluno({ titulo: a.titulo, descricao: a.descricao, youtubeId: a.youtubeId }));
    abrirModal("Prévia da aula", corpo);
  }

  function abrirFormAula(a) {
    const editando = Boolean(a);
    const corpo = el("div", "adm-aula-editor");
    const form = el("form", "adm-aula-form");
    const titulo = entrada("text", a ? a.titulo || "" : "", { maxlength: "120", required: "required", placeholder: "Como importar do YouTube" });
    const link = entrada("text", a && a.youtubeId ? `https://youtu.be/${a.youtubeId}` : "", { placeholder: "https://youtu.be/…", autocapitalize: "off", spellcheck: "false" });

    // módulo: escolhido da lista (o da aula, mesmo que tenha sumido, continua aparecendo)
    const modulo = document.createElement("select");
    const nomes = estado.modulos.map((m) => m.nome);
    const atual = a ? a.secao || "" : (nomes[0] || "");
    if (atual && !nomes.includes(atual)) nomes.unshift(atual);
    for (const n of nomes) {
      const op = el("option", "", n);
      op.value = n;
      modulo.appendChild(op);
    }
    modulo.value = atual;
    if (!nomes.length) {
      const op = el("option", "", "Crie um módulo antes");
      op.value = "";
      modulo.appendChild(op);
    }

    const ordem = entrada("number", a ? String(a.ordem ?? 100) : "100", { min: "0", max: "9999", inputmode: "numeric" });
    const desc = el("textarea");
    desc.rows = 5;
    desc.maxLength = 600;
    desc.placeholder = "O que a pessoa aprende nesta aula.";
    desc.value = a ? a.descricao || "" : "";
    const visivel = entrada("checkbox", null, {});
    visivel.checked = a ? a.ativo !== false : true;
    const rotuloVisivel = el("label", "adm-check");
    rotuloVisivel.append(visivel, el("span", "", "Aparecer para o cliente"));

    const previa = el("div", "adm-aula-previa-wrap");
    const atualizarPrevia = () => {
      const yt = youtubeId(link.value) || (a ? a.youtubeId : "");
      previa.innerHTML = "";
      previa.appendChild(el("p", "adm-ajuda", "Como aparece para o cliente"));
      previa.appendChild(cartaoAluno({ titulo: titulo.value || "Título da aula", descricao: desc.value, youtubeId: yt }));
    };
    [titulo, link, desc].forEach((x) => x.addEventListener("input", atualizarPrevia));
    atualizarPrevia();

    const salvar = botao("Salvar aula", "adm-bt adm-bt-forte", null);
    salvar.type = "submit";
    const cancelar = botao("Cancelar", "adm-bt adm-bt-fraco", () => fecharModal());
    const apagar = botao("Excluir aula", "adm-bt adm-bt-perigo", null);
    apagar.addEventListener("click", () => doisToques(apagar, () => ocupado(apagar, async () => {
      await rpc("ativavid_admin_aulas", { p_action: "delete", p_id: a.id });
      fecharModal();
      recado("Aula excluída.", "ok");
      await carregarAulas();
    })));
    const acoes = el("div", "adm-form-acoes adm-aula-acoes");
    acoes.append(salvar, cancelar);
    if (editando) acoes.append(apagar);

    form.append(
      campo("Título", titulo),
      campo("Link do YouTube", link, "Cole o link inteiro; o código do vídeo sai sozinho."),
      el("div", "adm-grade-2"),
      campo("Descrição", desc),
      rotuloVisivel,
      acoes
    );
    const grade = form.querySelector(".adm-grade-2");
    grade.append(campo("Módulo", modulo, "Agrupa as aulas. Os módulos se criam e se ordenam na lista de cima."), campo("Posição", ordem, "Menor aparece primeiro, dentro do módulo."));
    corpo.append(form, previa);

    const caixa = $("modal").querySelector(".adm-modal-caixa");
    caixa.classList.add("adm-modal-largo");

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const yt = youtubeId(link.value) || (a ? a.youtubeId : "");
      if (!titulo.value.trim()) return recado("A aula precisa de título.", "erro");
      if (!yt) return recado("Não achei o código do YouTube nesse link. Cole o link inteiro.", "erro");
      if (!modulo.value) return recado("Crie um módulo antes de salvar a aula.", "erro");
      ocupado(salvar, async () => {
        await rpc("ativavid_admin_aulas", {
          p_action: "upsert",
          p_id: a ? a.id : null,
          p_titulo: titulo.value.trim(),
          p_descricao: desc.value.trim(),
          p_youtube: yt,
          p_secao: modulo.value,
          p_ordem: Math.max(0, Math.min(9999, parseInt(ordem.value, 10) || 100)),
          p_ativo: visivel.checked,
        });
        fecharModal();
        recado("Aula salva.", "ok");
        await carregarAulas();
      });
    });

    abrirModal(editando ? "Editar aula" : "Nova aula", corpo);
  }

  // ============================================================ busca global  // ============================================================ busca global

  function buscaGlobal(ev) {
    if (!ev.target.value.trim()) return;
    if (estado.papel !== "admin") return;
    if (location.hash !== "#clientes") location.hash = "clientes";
    else desenharClientes();
  }

  // ============================================================ menus

  function fecharMenus() {
    $("menuPerfil").hidden = true;
    $("btPerfil").setAttribute("aria-expanded", "false");
    $("menuSino").hidden = true;
    $("btSino").setAttribute("aria-expanded", "false");
  }

  // ============================================================ ligar

  $("formEntrar").addEventListener("submit", entrar);
  $("btEsqueci").addEventListener("click", () => mostrarTrocar(true));
  $("btVoltar").addEventListener("click", () => mostrarTrocar(false));
  $("btPedirCodigo").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btReenviar").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btTrocar").addEventListener("click", (e) => trocarSenha(e.currentTarget));
  $("btSair").addEventListener("click", sair);
  $("btEditarPerfil").addEventListener("click", () => { fecharMenus(); editarPerfil(); });
  $("btMenu").addEventListener("click", () => aplicarMenu($("painel").classList.contains("adm-app--fechado")));
  $("btTema").addEventListener("click", alternarTema);
  $("buscaGlobal").addEventListener("input", buscaGlobal);
  $("btNovoCliente").addEventListener("click", abrirNovoCliente);
  $("ordem").addEventListener("change", (e) => { estado.ordem = e.target.value; desenharClientes(); });
  $("btNovaAula").addEventListener("click", () => abrirFormAula(null));
  $("btFecharConversa").addEventListener("click", fecharConversa);
  $("formResposta").addEventListener("submit", responder);
  $("statusResposta").addEventListener("change", mudarStatus);
  $("btNovoMembro").addEventListener("click", abrirNovoMembro);
  $("btVerSuporte").addEventListener("click", () => { fecharMenus(); location.hash = "suporte"; });
  $("btPerfil").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("menuPerfil");
    const abrir = menu.hidden;
    fecharMenus();
    menu.hidden = !abrir;
    $("btPerfil").setAttribute("aria-expanded", abrir ? "true" : "false");
  });
  $("btSino").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("menuSino");
    const abrir = menu.hidden;
    fecharMenus();
    menu.hidden = !abrir;
    $("btSino").setAttribute("aria-expanded", abrir ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".adm-perfil")) fecharMenus();
  });
  $("modal").addEventListener("click", (e) => {
    if (e.target.closest("[data-fechar]")) fecharModal();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("modal").hidden) fecharModal();
    if (ev.key === "/" && !/input|textarea|select/i.test(ev.target.tagName) && !$("painel").hidden) {
      ev.preventDefault();
      $("buscaGlobal").focus();
    }
  });
  window.addEventListener("hashchange", () => { if (!$("painel").hidden) rotear(); });

  lerPreferencias();
  $("btTema").setAttribute("aria-label", temaEfetivo() === "claro" ? "Usar tema escuro" : "Usar tema claro");

  sb.auth.getSession().then(async ({ data }) => {
    if (data && data.session) {
      const r = await abrirPainel();
      if (r && r.ok) return;
    }
    $("telaEntrar").hidden = false;
  });
})();
