/* Painel admin — ATIVAVID
 *
 * Quem decide o que cada chamada pode fazer é o Postgres, não esta página:
 *   - ativavid_admin_clientes()   leitura da ficha inteira (confere ativavid_is_admin)
 *   - ativavid_admin_license(...) ações de assinatura, e o whoami que abre o painel
 *   - ativavid_admin_aulas(...)   aulas
 *   - Edge Function admin-contas  criar login, apagar conta, bloquear computador
 *     (a service role mora lá, nunca aqui)
 *
 * A conta é a MESMA do aplicativo. A chave abaixo é a ANON, pública de propósito.
 */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";
  const TRIAL_DIAS = 7;
  const DIA = 86400000;

  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const estado = {
    clientes: [],
    semConta: [],
    filtro: "todos",
    ordem: "vencimento",
    abertos: new Set(),
    aulas: [],
    editandoAula: null,
    prazoNovo: 365,
    emailTroca: "",
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

  /** "agora", "há 5 min", "há 3 h", "há 2 dias" — e data quando passa de 30 dias. */
  const rel = (iso) => {
    const t = ms(iso);
    if (!t) return "nunca";
    const d = Date.now() - t;
    if (d < 0) return "agora";
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

  const iniciais = (email) => {
    const base = String(email || "?").split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
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

  /** Ações de assinatura: o RPC de admin, com a ação no p_action. */
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

  /** Trava o botão enquanto a tarefa roda; erro vai para o aviso que o chamador indicar. */
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

  /** Ação destrutiva em dois toques: o primeiro vira "Confirmar?" por 4 s. */
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

  // ============================================================ regras

  /** Plano pela duração da liberação — a mesma regra do painel do app. */
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

  /** Situação da conta. Ordem: bloqueada > sem login > vencida > vencendo > ativa. */
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

  /** Estado de um computador. Sem conta ele pode estar em trial. */
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

  // ============================================================= entrar / sair

  async function abrirPainel() {
    let quem;
    try {
      quem = await licenca("whoami");
    } catch (e) {
      await sb.auth.signOut();
      const msg = (e && e.message) || "";
      if (/forbidden|admin/i.test(msg)) return { ok: false, motivo: "nao_admin" };
      return { ok: false, motivo: "erro", detalhe: msg };
    }
    if (!quem.admin) {
      await sb.auth.signOut();
      return { ok: false, motivo: "nao_admin" };
    }
    $("quem").textContent = String(quem.email || "");
    $("telaEntrar").hidden = true;
    $("painel").hidden = false;
    $("senha").value = "";
    await carregar();
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
      if (r.motivo === "nao_admin") {
        throw new Error(`A conta ${email} entrou, mas não é admin. Use a conta de admin para abrir este painel.`);
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
      avisarEntrar("erroEntrar", r.motivo === "nao_admin"
        ? `Senha trocada. Mas ${estado.emailTroca} não é admin, então este painel não abre — use a senha nova no aplicativo.`
        : "Senha trocada, mas o servidor não confirmou quem é você. Entre de novo.", "ok");
    }, "avisoTrocar");
  }

  // ============================================================ carregar

  async function carregar() {
    const { data, error } = await sb.rpc("ativavid_admin_clientes");
    if (error) { recado(error.message || "Falhou ao carregar.", "erro"); return; }
    if (!data || data.ok === false) { recado((data && data.message) || "Sem permissão.", "erro"); return; }
    estado.clientes = Array.isArray(data.clientes) ? data.clientes : [];
    estado.semConta = Array.isArray(data.maquinasSemConta) ? data.maquinasSemConta : [];
    desenharTudo();
  }

  function desenharTudo() {
    desenharKpis();
    desenharFiltros();
    desenharClientes();
    desenharSemConta();
  }

  // ============================================================ indicadores

  function desenharKpis() {
    const cs = estado.clientes;
    const comLogin = cs.filter((c) => c.temLogin && c.status !== "revoked");
    const vencendo = comLogin.filter((c) => {
      const r = diasAte(c.validoAte);
      return r >= 0 && r <= 30;
    }).length;
    const vencidos = comLogin.filter((c) => diasAte(c.validoAte) < 0).length;
    const bloqueados = cs.filter((c) => c.status === "revoked").length;
    const maquinas = cs.flatMap((c) => c.computadores || []).concat(estado.semConta);
    const umDia = maquinas.filter((m) => Date.now() - ms(m.ultimoAcesso) < DIA).length;
    const videosMes = cs.reduce((s, c) => s + Number(c.videosMes || 0), 0);

    const itens = [
      ["Clientes ativos", comLogin.length - vencidos, "ok", `de ${cs.length} cadastrados`],
      ["Vencendo", vencendo, vencendo ? "atencao" : "neutro", "nos próximos 30 dias"],
      ["Vencidos", vencidos, vencidos ? "mal" : "neutro", bloqueados ? `${bloqueados} bloqueado(s)` : "nenhum bloqueado"],
      ["Online hoje", umDia, "ok", `de ${maquinas.length} computadores`],
      ["Vídeos este mês", videosMes, "neutro", "editados pelos clientes"],
    ];
    const kp = $("kpis");
    kp.innerHTML = "";
    for (const [rot, n, tom, sub] of itens) {
      const k = el("div", `adm-kpi adm-kpi-${tom}`);
      k.append(el("span", "adm-kpi-rot", rot), el("strong", "adm-kpi-n", n), el("span", "adm-kpi-sub", sub));
      kp.appendChild(k);
    }
  }

  // ============================================================ filtros

  const FILTROS = [
    ["todos", "Todos"],
    ["ativos", "Ativos"],
    ["vencendo", "Vencendo"],
    ["vencidos", "Vencidos"],
    ["bloqueados", "Bloqueados"],
    ["semlogin", "Sem login"],
    ["anual", "Anual"],
    ["mensal", "Mensal"],
  ];

  function desenharFiltros() {
    const alvo = $("filtros");
    alvo.innerHTML = "";
    for (const [k, rot] of FILTROS) {
      const b = el("button", "adm-chip-filtro", rot);
      b.type = "button";
      b.setAttribute("aria-pressed", estado.filtro === k ? "true" : "false");
      if (estado.filtro === k) b.classList.add("is-on");
      b.addEventListener("click", () => { estado.filtro = k; desenharFiltros(); desenharClientes(); });
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
      nome: (a, b) => String(a.email).localeCompare(String(b.email), "pt-BR"),
    }[estado.ordem];
    return lista.slice().sort(cmp);
  }

  // ============================================================ clientes

  function desenharClientes() {
    const q = $("busca").value.trim().toLowerCase();
    const alvo = $("listaClientes");
    const lista = ordenar(estado.clientes.filter((c) => casaFiltro(c) && casaBusca(c, q)));
    alvo.innerHTML = "";
    if (!lista.length) {
      alvo.appendChild(el("p", "adm-vazio", estado.clientes.length
        ? "Nenhum cliente com este filtro."
        : "Nenhum cliente ainda. Use “Novo cliente” acima."));
      return;
    }
    for (const c of lista) alvo.appendChild(cartaoCliente(c));
  }

  function cartaoCliente(c) {
    const s = situacaoDe(c);
    const p = planoDe(c);
    const maqs = c.computadores || [];
    const aberto = estado.abertos.has(c.id);

    const art = el("article", `adm-cli adm-cli-${s.tom}`);
    art.dataset.id = c.id;

    // ---- topo: quem é e como está
    const topo = el("div", "adm-cli-topo");
    topo.append(el("span", `adm-avatar adm-avatar-${s.tom}`, iniciais(c.email)));
    const quem = el("div", "adm-cli-quem");
    quem.append(el("h3", "adm-cli-email", c.email));
    quem.append(el("p", "adm-cli-sub", `Cliente desde ${dia(c.clienteDesde)} · último acesso ${rel(ultimoAcessoDo(c))}`));
    topo.appendChild(quem);
    const chips = el("div", "adm-cli-chips");
    chips.append(chip(p.nome, "plano", "adm-chip-plano"), chip(s.rot, s.tom));
    topo.appendChild(chips);
    art.appendChild(topo);

    // ---- validade
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

    // ---- números
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
      numero("Aberturas", String(c.aberturasTotal || 0), c.ultimaAbertura ? `última ${rel(c.ultimaAbertura)}` : "nunca abriu"),
      numero("Último vídeo", c.ultimoVideo ? rel(c.ultimoVideo) : "—", c.ultimoVideo ? dia(c.ultimoVideo) : ""),
    );
    art.appendChild(numeros);

    // ---- expandir
    const bt = el("button", "adm-expandir", aberto ? "Fechar ficha" : "Abrir ficha");
    bt.type = "button";
    bt.setAttribute("aria-expanded", aberto ? "true" : "false");
    bt.addEventListener("click", () => {
      if (estado.abertos.has(c.id)) estado.abertos.delete(c.id); else estado.abertos.add(c.id);
      desenharClientes();
    });
    art.appendChild(bt);

    if (aberto) art.appendChild(fichaCliente(c));
    return art;
  }

  function fichaCliente(c) {
    const p = planoDe(c);
    const s = situacaoDe(c);
    const maqs = c.computadores || [];
    const f = el("div", "adm-ficha");

    // ---- coluna da assinatura
    const sub = el("section", "adm-ficha-col");
    sub.appendChild(el("h4", "adm-ficha-titulo", "Assinatura"));
    const dl = el("dl", "adm-ficha-dados");
    const linha = (rot, valor) => {
      const dt = el("dt", "", rot);
      const dd = el("dd", "", valor);
      dl.append(dt, dd);
    };
    linha("Plano", p.nome);
    linha("Situação", s.rot);
    linha("Início", dia(c.clienteDesde));
    linha("Vence em", dia(c.validoAte));
    linha("Último acesso", rel(ultimoAcessoDo(c)));
    linha("Último vídeo", c.ultimoVideo ? `${dia(c.ultimoVideo)} (${rel(c.ultimoVideo)})` : "nenhum ainda");
    linha("Mexido em", dia(c.atualizadoEm));
    if (c.anotacao) linha("Anotação", c.anotacao);
    sub.appendChild(dl);

    if (!c.temLogin) {
      sub.appendChild(el("p", "adm-ficha-alerta",
        "Os dias estão reservados, mas só valem quando existir login com este e-mail. Use “Criar e liberar” ou peça que o cliente se cadastre."));
    }

    // ---- ações da assinatura
    const acoes = el("div", "adm-acoes");
    const prazo = el("div", "adm-seg adm-seg-mini");
    prazo.setAttribute("role", "radiogroup");
    prazo.setAttribute("aria-label", "Dias a liberar");
    let escolhido = 30;
    for (const d of [30, 90, 180, 365]) {
      const b = el("button", d === escolhido ? "is-on" : "", d === 365 ? "1 ano" : `${d} dias`);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", d === escolhido ? "true" : "false");
      b.dataset.dias = String(d);
      b.addEventListener("click", () => {
        escolhido = d;
        $$("button", prazo).forEach((x) => {
          const on = x === b;
          x.classList.toggle("is-on", on);
          x.setAttribute("aria-checked", on ? "true" : "false");
        });
      });
      prazo.appendChild(b);
    }
    const liberar = el("button", "adm-bt adm-bt-forte adm-bt-sm", c.temLogin ? "Renovar" : "Liberar");
    liberar.type = "button";
    liberar.addEventListener("click", () => ocupado(liberar, async () => {
      const r = await licenca("grant_access", { p_email: c.email, p_days: escolhido, p_max_devices: c.maxComputadores || 1 });
      recado(r.message || "Acesso liberado.", r.pendingSignup ? "atencao" : "ok");
      await carregar();
    }));

    const bloquear = el("button", "adm-bt adm-bt-fraco adm-bt-sm", c.status === "revoked" ? "Já bloqueada" : "Bloquear acesso");
    bloquear.type = "button";
    bloquear.disabled = c.status === "revoked";
    bloquear.addEventListener("click", () => doisToques(bloquear, () => ocupado(bloquear, async () => {
      const r = await licenca("revoke_access", { p_email: c.email });
      recado(r.message || "Acesso bloqueado.", "ok");
      await carregar();
    })));

    const excluir = el("button", "adm-bt adm-bt-perigo adm-bt-sm", "Excluir cliente");
    excluir.type = "button";
    excluir.addEventListener("click", () => doisToques(excluir, () => ocupado(excluir, async () => {
      const r = await fn({ acao: "apagar_conta", email: c.email });
      recado(r.message || "Conta apagada.", "ok");
      estado.abertos.delete(c.id);
      await carregar();
    })));

    acoes.append(prazo, liberar, bloquear, excluir);
    sub.appendChild(acoes);
    f.appendChild(sub);

    // ---- coluna dos computadores
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

  /** Um computador, com o e-mail que usou nele, o uso e o que fazer com ele. */
  function linhaMaquina(m, c) {
    const st = estadoMaquina(m, c);
    const box = el("div", `adm-maq adm-maq-${st.tom}`);

    const topo = el("div", "adm-maq-topo");
    const nome = el("div", "adm-maq-nome");
    nome.append(el("strong", "", m.label || m.host || shortId(m.deviceId)));
    nome.append(el("span", "adm-maq-id", [m.host, m.osUser].filter(Boolean).join(" · ") || shortId(m.deviceId)));
    topo.append(nome, chip(st.rot, st.tom));
    box.appendChild(topo);

    const grade = el("dl", "adm-maq-grade");
    const campo = (rot, valor) => { grade.append(el("dt", "", rot), el("dd", "", valor)); };
    campo("Último e-mail que abriu", ultimoEmailDo(m) || "—");
    campo("Último acesso", rel(m.ultimoAcesso));
    campo("Aberturas", String(m.aberturas || 0));
    campo("Vídeos", `${m.videosMes || 0} este mês · ${m.videos || 0} no total`);
    campo("Primeira vez", dia(m.primeiraVez));
    if (m.bloqueadoEm) campo("Bloqueado em", `${dia(m.bloqueadoEm)}${m.motivoBloqueio ? ` — ${m.motivoBloqueio}` : ""}`);
    box.appendChild(grade);

    box.appendChild(botaoBloquearMaquina(m));
    return box;
  }

  function botaoBloquearMaquina(m) {
    const bloqueada = Boolean(m.bloqueadoEm);
    const bt = el("button", bloqueada ? "adm-bt adm-bt-fraco adm-bt-sm" : "adm-bt adm-bt-perigo adm-bt-sm",
      bloqueada ? "Desbloquear" : "Bloquear computador");
    bt.type = "button";
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

  function shortId(id) {
    const s = String(id || "");
    return s.length > 14 ? `${s.slice(0, 14)}…` : s;
  }

  // ============================================================ sem conta

  function desenharSemConta() {
    const alvo = $("listaSemConta");
    alvo.innerHTML = "";
    if (!estado.semConta.length) {
      alvo.appendChild(el("p", "adm-vazio", "Todo computador que abriu o ATIVAVID está ligado a um cliente."));
      return;
    }
    for (const m of estado.semConta) {
      const st = estadoMaquina(m, null);
      const box = el("div", `adm-maq adm-maq-${st.tom}`);
      const topo = el("div", "adm-maq-topo");
      const nome = el("div", "adm-maq-nome");
      nome.append(el("strong", "", m.label || m.host || shortId(m.deviceId)));
      nome.append(el("span", "adm-maq-id", [m.host, m.osUser].filter(Boolean).join(" · ") || shortId(m.deviceId)));
      topo.append(nome, chip(st.rot, st.tom));
      box.appendChild(topo);
      const grade = el("dl", "adm-maq-grade");
      const campo = (rot, valor) => { grade.append(el("dt", "", rot), el("dd", "", valor)); };
      campo("Último e-mail que abriu", ultimoEmailDo(m) || "—");
      campo("Último acesso", rel(m.ultimoAcesso));
      campo("Aberturas", String(m.aberturas || 0));
      campo("Vídeos", `${m.videosMes || 0} este mês · ${m.videos || 0} no total`);
      campo("Início do trial", m.trialInicio ? dia(m.trialInicio) : "sem trial");
      box.appendChild(grade);
      box.appendChild(botaoBloquearMaquina(m));
      alvo.appendChild(box);
    }
  }

  // ============================================================ criar cliente

  function criarCliente(bt) {
    const email = $("novoEmail").value.trim().toLowerCase();
    const senha = $("novaSenha").value.trim();
    const dias = estado.prazoNovo;
    if (!email.includes("@")) return recado("Informe o e-mail do cliente.", "erro");
    if (senha.length < 6) return recado("A senha provisória precisa de pelo menos 6 caracteres.", "erro");
    return ocupado(bt, async () => {
      // Login primeiro: o grant_access só acha o user_id se a conta já existir.
      const login = await fn({ acao: "criar_login", email, senha });
      const acesso = await licenca("grant_access", { p_email: email, p_days: dias, p_max_devices: 1 });
      recado(`${login.message || "Login pronto."} ${acesso.message || ""}`.trim(),
        acesso.pendingSignup ? "atencao" : "ok");
      $("novoEmail").value = "";
      $("novaSenha").value = "";
      const novo = document.querySelector(".adm-novo");
      if (novo) novo.open = false;
      await carregar();
    });
  }

  function escolherPrazoNovo(bt) {
    estado.prazoNovo = Number(bt.dataset.dias);
    $$("#novoPrazo button").forEach((x) => {
      const on = x === bt;
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-checked", on ? "true" : "false");
    });
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
    const r = await rpc("ativavid_admin_aulas", { p_action: "list" });
    estado.aulas = Array.isArray(r.aulas) ? r.aulas : [];
    desenharAulas();
  }

  function desenharAulas() {
    const alvo = $("listaAulas");
    alvo.innerHTML = "";
    const secoes = [...new Set(estado.aulas.map((a) => a.secao).filter(Boolean))];
    $("secoesExistentes").innerHTML = "";
    for (const s of secoes) {
      const o = document.createElement("option");
      o.value = s;
      $("secoesExistentes").appendChild(o);
    }
    if (!estado.aulas.length) {
      alvo.appendChild(el("p", "adm-vazio", "Nenhuma aula cadastrada. Use “Nova aula” para começar."));
      return;
    }
    const ordenadas = estado.aulas.slice().sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));
    for (const a of ordenadas) {
      const linha = el("article", `adm-aula ${a.ativo === false ? "is-oculta" : ""}`);
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
      meta.append(el("span", "", `Ordem ${a.ordem ?? 100}`));
      meta.append(el("span", "", a.ativo === false ? "oculta para o cliente" : "visível para o cliente"));
      corpo.appendChild(meta);
      const acoes = el("div", "adm-acoes");
      const editar = el("button", "adm-bt adm-bt-fraco adm-bt-sm", "Editar");
      editar.type = "button";
      editar.addEventListener("click", () => abrirFormAula(a));
      const apagar = el("button", "adm-bt adm-bt-perigo adm-bt-sm", "Excluir");
      apagar.type = "button";
      apagar.addEventListener("click", () => doisToques(apagar, () => ocupado(apagar, async () => {
        await rpc("ativavid_admin_aulas", { p_action: "delete", p_id: a.id });
        recado("Aula excluída.", "ok");
        await carregarAulas();
      })));
      acoes.append(editar, apagar);
      corpo.appendChild(acoes);
      linha.append(capa, corpo);
      alvo.appendChild(linha);
    }
  }

  function abrirFormAula(a) {
    estado.editandoAula = a ? a.id : null;
    $("tituloFormAula").textContent = a ? "Editar aula" : "Nova aula";
    $("aulaTitulo").value = a ? a.titulo || "" : "";
    $("aulaLink").value = a && a.youtubeId ? `https://youtu.be/${a.youtubeId}` : "";
    $("aulaSecao").value = a ? a.secao || "" : "";
    $("aulaOrdem").value = a ? String(a.ordem ?? 100) : "100";
    $("aulaDescricao").value = a ? a.descricao || "" : "";
    $("aulaAtivo").checked = a ? a.ativo !== false : true;
    $("formAula").hidden = false;
    $("formAula").scrollIntoView({ block: "start", behavior: "smooth" });
    $("aulaTitulo").focus();
  }

  function fecharFormAula() {
    $("formAula").hidden = true;
    estado.editandoAula = null;
  }

  function salvarAula(bt) {
    const titulo = $("aulaTitulo").value.trim();
    const yt = youtubeId($("aulaLink").value);
    if (!titulo) return recado("A aula precisa de título.", "erro");
    if (!yt) return recado("Não achei o código do YouTube nesse link. Cole o link inteiro.", "erro");
    return ocupado(bt, async () => {
      await rpc("ativavid_admin_aulas", {
        p_action: "upsert",
        p_id: estado.editandoAula,
        p_titulo: titulo,
        p_descricao: $("aulaDescricao").value.trim(),
        p_youtube: yt,
        p_secao: $("aulaSecao").value.trim() || "Geral",
        p_ordem: Math.max(0, Math.min(9999, parseInt($("aulaOrdem").value, 10) || 100)),
        p_ativo: $("aulaAtivo").checked,
      });
      recado("Aula salva.", "ok");
      fecharFormAula();
      await carregarAulas();
    });
  }

  // ============================================================ abas

  function trocarAba(nome) {
    $$(".adm-aba").forEach((b) => {
      const on = b.dataset.aba === nome;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("abaClientes").hidden = nome !== "clientes";
    $("abaAulas").hidden = nome !== "aulas";
    if (nome === "aulas") carregarAulas().catch((e) => recado(e.message, "erro"));
  }

  // ============================================================ ligar

  $("formEntrar").addEventListener("submit", entrar);
  $("btEsqueci").addEventListener("click", () => mostrarTrocar(true));
  $("btVoltar").addEventListener("click", () => mostrarTrocar(false));
  $("btPedirCodigo").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btReenviar").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btTrocar").addEventListener("click", (e) => trocarSenha(e.currentTarget));
  $("btSair").addEventListener("click", sair);
  $("btCriar").addEventListener("click", (e) => criarCliente(e.currentTarget));
  $$("#novoPrazo button").forEach((b) => b.addEventListener("click", () => escolherPrazoNovo(b)));
  $("busca").addEventListener("input", desenharClientes);
  $("ordem").addEventListener("change", (e) => { estado.ordem = e.target.value; desenharClientes(); });
  $$(".adm-aba").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
  $("btNovaAula").addEventListener("click", () => abrirFormAula(null));
  $("btCancelarAula").addEventListener("click", fecharFormAula);
  $("btSalvarAula").addEventListener("click", (e) => salvarAula(e.currentTarget));

  // Sessão guardada não é permissão: ela só evita redigitar a senha.
  // Quem abre o painel continua sendo o whoami do servidor.
  sb.auth.getSession().then(({ data }) => {
    if (data && data.session) abrirPainel();
  });
})();
