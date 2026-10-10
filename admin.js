/* Painel do dono — ATIVAVID
 *
 * Não existe backend novo aqui. A página fala com o que o app já usa:
 *   - RPC `ativavid_admin_license`, que confere `ativavid_is_admin()` ANTES
 *     de qualquer ação, com o token de quem chamou;
 *   - Edge Function `admin-contas`, onde mora a service role (nunca aqui).
 *
 * A conta é a MESMA do aplicativo: Windows, Mac e iPhone entram por este
 * mesmo Auth, e a troca de senha usa o mesmo caminho (código no e-mail →
 * /auth/v1/verify com type=recovery), igual a `app/auth.py`.
 *
 * A chave abaixo é a ANON, pública de propósito: quem decide o que ela pode
 * fazer é o Postgres, não este arquivo.
 */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";

  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);

  const estado = { acessos: [], aparelhos: [], emailTroca: "" };

  // ---------------------------------------------------------------- utilidades

  const texto = (v) => String(v == null ? "" : v);

  function dia(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function venceu(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
  }

  /** Mostra um aviso num <p>. `tom` "ok" pinta de verde; o padrão é erro. */
  function avisar(id, msg, tom) {
    const el = $(id);
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    if (tom) el.dataset.tom = tom; else delete el.dataset.tom;
    el.hidden = false;
  }

  /** Recado do painel. Só serve DEPOIS de entrar — o painel está escondido antes. */
  function recado(msg, tom) {
    const el = $("recado");
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.dataset.tom = tom || "ok";
    el.hidden = false;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function rpc(acao, args) {
    const { data, error } = await sb.rpc("ativavid_admin_license",
      Object.assign({ p_action: acao }, args || {}));
    if (error) throw new Error(error.message || "Falhou a chamada ao servidor.");
    if (data && data.ok === false) throw new Error(data.message || data.error || "Recusado.");
    return data || {};
  }

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

  /** Roda a tarefa travando o botão. `ondeAvisar` é o id do <p> que mostra a
   *  falha — sem ele o erro iria para o painel escondido e sumiria da vista. */
  async function comBotao(bt, tarefa, ondeAvisar) {
    if (bt.disabled) return;
    const antes = bt.textContent;
    bt.disabled = true;
    bt.textContent = "…";
    try {
      await tarefa();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (ondeAvisar) avisar(ondeAvisar, msg);
      else recado(msg, "erro");
    } finally {
      bt.disabled = false;
      bt.textContent = antes;
    }
  }

  // ------------------------------------------------------------------- entrar

  async function entrar(ev) {
    ev.preventDefault();
    avisar("erroEntrar", "");
    const email = $("email").value.trim().toLowerCase();
    await comBotao($("btEntrar"), async () => {
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
        throw new Error(`A conta ${email} entrou, mas não é admin. Só e-mails da tabela "admins" abrem este painel.`);
      }
      throw new Error(r.detalhe || "O servidor não confirmou quem é você. Tente de novo.");
    }, "erroEntrar");
  }

  /** Só o servidor decide se o painel abre. Devolve o motivo quando não abre,
   *  para a tela conseguir dizer o que houve em vez de ficar muda. */
  async function abrirPainel() {
    let quem;
    try {
      quem = await rpc("whoami");
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
    $("quem").textContent = texto(quem.email);
    $("telaEntrar").hidden = true;
    $("painel").hidden = false;
    $("senha").value = "";
    await carregar();
    return { ok: true };
  }

  async function sair() {
    await sb.auth.signOut();
    location.reload();
  }

  // ------------------------------------------------------- trocar a senha

  function mostrarTrocar(mostrar) {
    $("formEntrar").hidden = mostrar;
    $("formTrocar").hidden = !mostrar;
    avisar("avisoTrocar", "");
    if (mostrar) $("emailTrocar").value = $("email").value.trim().toLowerCase();
  }

  function pedirCodigo(bt) {
    const email = $("emailTrocar").value.trim().toLowerCase();
    if (!email.includes("@")) return avisar("avisoTrocar", "Informe o e-mail da sua conta.");
    return comBotao(bt, async () => {
      // Mesma rota que o app usa (/auth/v1/recover). O modelo do e-mail tem
      // {{ .Token }}, então chega CÓDIGO — não link.
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) throw new Error(error.message || "Não consegui mandar o código.");
      estado.emailTroca = email;
      $("passoPedir").hidden = true;
      $("passoCodigo").hidden = false;
      avisar("avisoTrocar",
        `Se existir conta com ${email}, o código chega em instantes. Olhe também o spam.`, "ok");
      $("codigo").focus();
    }, "avisoTrocar");
  }

  function trocarSenha(bt) {
    const codigo = $("codigo").value.replace(/\D/g, "");
    const senha = $("senhaNova").value;
    if (codigo.length < 4) return avisar("avisoTrocar", "Digite o código que chegou no e-mail.");
    if (senha.length < 6) return avisar("avisoTrocar", "A senha nova precisa de pelo menos 6 caracteres.");

    return comBotao(bt, async () => {
      // verify (type=recovery) abre uma sessão de verdade; updateUser grava a
      // senha nova. É o mesmo par que `app/auth.py` faz no computador.
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
      // Trocou. Agora o painel só abre se esta conta for admin.
      const r = await abrirPainel();
      if (r.ok) return;
      mostrarTrocar(false);
      avisar("erroEntrar", r.motivo === "nao_admin"
        ? `Senha trocada. Mas ${estado.emailTroca} não é admin, então este painel não abre — use a senha nova no aplicativo.`
        : "Senha trocada, mas o servidor não confirmou quem é você. Entre de novo.", "ok");
    }, "avisoTrocar");
  }

  // ------------------------------------------------------------------ carregar

  async function carregar() {
    recado("");
    try {
      const [a, d] = await Promise.all([rpc("list_access"), rpc("list_devices")]);
      estado.acessos = Array.isArray(a.access) ? a.access : [];
      estado.aparelhos = Array.isArray(d.devices) ? d.devices : [];
    } catch (e) {
      recado((e && e.message) || String(e), "erro");
      return;
    }
    desenhar();
  }

  function filtrados(itens, campo) {
    const q = $("busca").value.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter((i) => texto(i[campo]).toLowerCase().includes(q));
  }

  // ------------------------------------------------------------- assinaturas

  function selo(a) {
    if (a.status === "revoked") return '<span class="adm-selo adm-selo-mal">Bloqueada</span>';
    if (!a.user_id) return '<span class="adm-selo adm-selo-espera">Sem conta</span>';
    if (venceu(a.valid_until)) return '<span class="adm-selo adm-selo-mal">Vencida</span>';
    return '<span class="adm-selo adm-selo-ok">Ativa</span>';
  }

  /** Os computadores daquela conta. O vínculo é o `account_access_id`, que o
   *  `rpc_license` grava quando a máquina entra pela CONTA; quem entrou pelo
   *  caminho antigo, de chave, fica sem dono — por isso a ficha diz quantos. */
  function maquinasDe(email) {
    const e = texto(email).toLowerCase();
    return estado.aparelhos.filter((d) => texto(d.account_email).toLowerCase() === e);
  }

  function ultimoAcesso(maquinas) {
    const ts = maquinas
      .map((d) => (d.last_seen ? new Date(d.last_seen).getTime() : 0))
      .filter((n) => n > 0);
    return ts.length ? new Date(Math.max(...ts)).toISOString() : "";
  }

  function montarFicha(a) {
    const maqs = maquinasDe(a.email);
    const visto = ultimoAcesso(maqs);
    const ficha = document.createElement("div");
    ficha.className = "adm-ficha";

    const linhas = [
      ["Situação", a.status === "revoked" ? "Bloqueada" : "Ativa"],
      ["Vale até", dia(a.valid_until)],
      ["Último acesso", visto ? dia(visto) : "nunca abriu o app"],
      ["Computadores", `${maqs.length} de ${a.max_devices || 1} permitido(s)`],
      ["Cliente desde", dia(a.created_at)],
      ["Mexido pela última vez", dia(a.updated_at)],
    ];
    if (a.notes) linhas.push(["Anotação", a.notes]);
    if (!a.user_id) linhas.push(["Login", "ainda não existe — os dias não valem"]);

    const dl = document.createElement("dl");
    dl.className = "adm-ficha-dados";
    for (const [rotulo, valor] of linhas) {
      const dt = document.createElement("dt");
      dt.textContent = rotulo;
      const dd = document.createElement("dd");
      dd.textContent = valor;
      dl.append(dt, dd);
    }
    ficha.appendChild(dl);

    const titulo = document.createElement("p");
    titulo.className = "adm-ficha-titulo";
    titulo.textContent = maqs.length ? "Computadores desta conta" : "Nenhum computador vinculado a esta conta";
    ficha.appendChild(titulo);

    for (const d of maqs) {
      const m = document.createElement("div");
      m.className = "adm-maquina";
      const nome = document.createElement("b");
      nome.textContent = texto(d.label) || texto(d.device_id).slice(0, 16) || "Computador";
      const quando = document.createElement("span");
      quando.textContent = d.last_seen ? `visto em ${dia(d.last_seen)}` : "nunca visto";
      m.append(nome, quando);
      ficha.appendChild(m);
    }
    return ficha;
  }

  function desenharAssinaturas() {
    const alvo = $("listaAssinaturas");
    const itens = filtrados(estado.acessos, "email");
    if (!itens.length) {
      alvo.innerHTML = '<p class="adm-vazio">Nenhuma assinatura por aqui.</p>';
      return;
    }
    alvo.innerHTML = "";
    for (const a of itens) {
      const maqs = maquinasDe(a.email);
      const linha = document.createElement("div");
      linha.className = "adm-linha";
      linha.innerHTML = `
        <div>
          <div class="adm-linha-topo">
            <span class="adm-nome"></span>
            ${selo(a)}
          </div>
          <p class="adm-dado">
            Vale até <b>${dia(a.valid_until)}</b> · ${maqs.length} de ${a.max_devices || 1} computador(es)
            ${a.user_id ? "" : '<br>Os dias estão reservados, mas <b>só valem depois que existir login com este e-mail</b>.'}
          </p>
        </div>
        <div class="adm-verbos">
          <button class="adm-verbo" type="button" data-fazer="ficha" aria-expanded="false">Ficha</button>
          <button class="adm-verbo" type="button" data-fazer="renovar">Renovar</button>
          <button class="adm-verbo" type="button" data-fazer="bloquear">Bloquear</button>
          <button class="adm-verbo adm-verbo-perigo" type="button" data-fazer="excluir">Excluir</button>
        </div>`;
      // textContent, não innerHTML: e-mail é dado de fora e não vira marcação.
      linha.querySelector(".adm-nome").textContent = texto(a.email);
      linha.querySelectorAll("[data-fazer]").forEach((bt) => {
        if (bt.dataset.fazer === "ficha") {
          bt.addEventListener("click", () => {
            const aberta = linha.querySelector(".adm-ficha");
            if (aberta) { aberta.remove(); bt.setAttribute("aria-expanded", "false"); return; }
            linha.appendChild(montarFicha(a));
            bt.setAttribute("aria-expanded", "true");
          });
          return;
        }
        bt.addEventListener("click", () => verboAssinatura(bt, bt.dataset.fazer, a));
      });
      alvo.appendChild(linha);
    }
  }

  function verboAssinatura(bt, qual, a) {
    const email = texto(a.email);

    if (qual === "renovar") {
      const dias = prompt(`Renovar ${email} por quantos dias?`, "365");
      if (dias === null) return;
      const n = Math.max(1, Math.min(3650, parseInt(dias, 10) || 0));
      if (!n) return;
      return comBotao(bt, async () => {
        const r = await rpc("grant_access", { p_email: email, p_days: n, p_max_devices: a.max_devices || 1 });
        recado(r.message || "Acesso liberado.", r.pendingSignup ? "atencao" : "ok");
        await carregar();
      });
    }

    if (qual === "bloquear") {
      if (!confirm(`Bloquear o acesso de ${email}?\n\nOs computadores dele param de funcionar. A assinatura continua gravada e dá para renovar depois.`)) return;
      return comBotao(bt, async () => {
        const r = await rpc("revoke_access", { p_email: email });
        recado(r.message || "Acesso bloqueado.", "ok");
        await carregar();
      });
    }

    if (qual === "excluir") {
      if (!confirm(`Excluir ${email} de vez?\n\nApaga o acesso E o login do cliente, e desvincula os computadores. Não dá para desfazer.`)) return;
      return comBotao(bt, async () => {
        const r = await fn({ acao: "apagar_conta", email });
        recado(r.message || "Conta apagada.", "ok");
        await carregar();
      });
    }
  }

  // ------------------------------------------------------------ computadores

  function desenharComputadores() {
    const alvo = $("listaComputadores");
    const itens = filtrados(estado.aparelhos, "account_email");
    if (!itens.length) {
      alvo.innerHTML = '<p class="adm-vazio">Nenhum computador por aqui.</p>';
      return;
    }
    alvo.innerHTML = "";
    for (const d of itens) {
      const mal = d.status === "blocked" || venceu(d.valid_until);
      const linha = document.createElement("div");
      linha.className = "adm-linha";
      linha.innerHTML = `
        <div>
          <div class="adm-linha-topo">
            <span class="adm-nome"></span>
            <span class="adm-selo ${mal ? "adm-selo-mal" : "adm-selo-ok"}">${mal ? "Parado" : "Ativo"}</span>
          </div>
          <p class="adm-dado">
            Dono: <b class="adm-dono"></b><br>
            Visto em <b>${dia(d.last_seen)}</b> · vale até <b>${dia(d.valid_until)}</b>
          </p>
        </div>
        <div class="adm-verbos">
          <button class="adm-verbo adm-verbo-perigo" type="button">Bloquear</button>
        </div>`;
      linha.querySelector(".adm-nome").textContent = texto(d.label) || texto(d.device_id).slice(0, 12) || "Computador";
      linha.querySelector(".adm-dono").textContent = texto(d.account_email) || "sem conta";
      const bt = linha.querySelector("button");
      bt.addEventListener("click", () => {
        if (!confirm("Bloquear este computador?\n\nO ATIVAVID para de abrir nele. A assinatura do cliente continua valendo nos outros.")) return;
        comBotao(bt, async () => {
          const r = await fn({ acao: "bloquear_maquina", device_id: d.device_id });
          recado(r.message || "Computador bloqueado.", "ok");
          await carregar();
        });
      });
      alvo.appendChild(linha);
    }
  }

  function desenhar() {
    desenharAssinaturas();
    desenharComputadores();
  }

  // ------------------------------------------------------------ criar cliente

  function criarCliente() {
    const email = $("novoEmail").value.trim().toLowerCase();
    const senha = $("novaSenha").value.trim();
    const dias = Math.max(1, Math.min(3650, parseInt($("novoDias").value, 10) || 365));
    if (!email.includes("@")) return recado("Informe o e-mail do cliente.", "erro");
    if (senha.length < 6) return recado("A senha provisória precisa de pelo menos 6 caracteres.", "erro");

    return comBotao($("btCriar"), async () => {
      // Dois passos de propósito: o login nasce primeiro para que o grant_access
      // ache o user_id e o acesso já valha. Invertido, cairia em "Sem conta".
      const login = await fn({ acao: "criar_login", email, senha });
      const acesso = await rpc("grant_access", { p_email: email, p_days: dias, p_max_devices: 1 });
      recado(`${login.message || "Login pronto."} ${acesso.message || ""}`.trim(),
        acesso.pendingSignup ? "atencao" : "ok");
      $("novoEmail").value = "";
      $("novaSenha").value = "";
      await carregar();
    });
  }

  // -------------------------------------------------------------------- abas

  function trocarAba(nome) {
    document.querySelectorAll(".adm-aba").forEach((b) => {
      const on = b.dataset.aba === nome;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("abaAssinaturas").hidden = nome !== "assinaturas";
    $("abaComputadores").hidden = nome !== "computadores";
  }

  // ------------------------------------------------------------------- ligar

  $("formEntrar").addEventListener("submit", entrar);
  $("btEsqueci").addEventListener("click", () => mostrarTrocar(true));
  $("btVoltar").addEventListener("click", () => mostrarTrocar(false));
  $("btPedirCodigo").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btReenviar").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btTrocar").addEventListener("click", (e) => trocarSenha(e.currentTarget));
  $("btSair").addEventListener("click", sair);
  $("btCriar").addEventListener("click", criarCliente);
  $("btRecarregar").addEventListener("click", (e) => comBotao(e.currentTarget, carregar));
  $("busca").addEventListener("input", desenhar);
  document.querySelectorAll(".adm-aba").forEach((b) => {
    b.addEventListener("click", () => trocarAba(b.dataset.aba));
  });

  // Sessão guardada não é permissão: ela só evita redigitar a senha. Quem abre
  // o painel continua sendo o `whoami` lá em cima.
  sb.auth.getSession().then(({ data }) => {
    if (data && data.session) abrirPainel();
  });
})();
