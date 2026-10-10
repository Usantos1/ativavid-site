/* Painel do dono — ATIVAVID
 *
 * Não existe backend novo aqui. A página fala com o que o app já usa:
 *   - RPC `ativavid_admin_license`, que confere `ativavid_is_admin()` ANTES
 *     de qualquer ação, com o token de quem chamou;
 *   - Edge Function `admin-contas`, onde mora a service role (nunca aqui).
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

  const estado = { acessos: [], aparelhos: [], aba: "assinaturas" };

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

  function recado(msg, tom) {
    const el = $("recado");
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.dataset.tom = tom || "ok";
    el.hidden = false;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Chama o RPC de admin. Ele reconfere quem somos a cada chamada. */
  async function rpc(acao, args) {
    const { data, error } = await sb.rpc("ativavid_admin_license",
      Object.assign({ p_action: acao }, args || {}));
    if (error) throw new Error(error.message || "Falhou a chamada ao servidor.");
    if (data && data.ok === false) throw new Error(data.message || data.error || "Recusado.");
    return data || {};
  }

  /** Chama a Edge Function (a que tem a service role do lado de lá). */
  async function fn(corpo) {
    const { data, error } = await sb.functions.invoke("admin-contas", { body: corpo });
    if (error) {
      // O corpo do erro traz a mensagem boa; o `error.message` sozinho diz só "non-2xx".
      let detalhe = "";
      try { detalhe = (await error.context?.json())?.message || ""; } catch { /* sem corpo */ }
      throw new Error(detalhe || error.message || "Falhou a chamada ao servidor.");
    }
    if (data && data.ok === false) throw new Error(data.message || "Recusado.");
    return data || {};
  }

  /** Roda uma ação travando o botão, para não disparar duas vezes no toque. */
  async function comBotao(bt, tarefa) {
    if (bt.disabled) return;
    const antes = bt.textContent;
    bt.disabled = true;
    bt.textContent = "…";
    try {
      await tarefa();
    } catch (e) {
      recado(e.message || String(e), "erro");
    } finally {
      bt.disabled = false;
      bt.textContent = antes;
    }
  }

  // ------------------------------------------------------------------- entrar

  async function entrar(ev) {
    ev.preventDefault();
    const err = $("erroEntrar");
    err.hidden = true;
    await comBotao($("btEntrar"), async () => {
      const { error } = await sb.auth.signInWithPassword({
        email: $("email").value.trim().toLowerCase(),
        password: $("senha").value,
      });
      if (error) {
        err.textContent = /invalid/i.test(error.message || "")
          ? "E-mail ou senha errados."
          : (error.message || "Não consegui entrar.");
        err.hidden = false;
        return;
      }
      const ok = await abrirPainel();
      if (!ok) {
        err.textContent = "Esta conta não é de admin.";
        err.hidden = false;
      }
    });
  }

  /** Só o servidor decide se o painel abre. Sem isso, seria palpite do navegador. */
  async function abrirPainel() {
    let quem;
    try {
      quem = await rpc("whoami");
    } catch {
      await sb.auth.signOut();
      return false;
    }
    if (!quem.admin) {
      await sb.auth.signOut();
      return false;
    }
    $("quem").textContent = texto(quem.email);
    $("telaEntrar").hidden = true;
    $("painel").hidden = false;
    $("senha").value = "";
    await carregar();
    return true;
  }

  async function sair() {
    await sb.auth.signOut();
    location.reload();
  }

  // ------------------------------------------------------------------ carregar

  async function carregar() {
    recado("");
    try {
      const [a, d] = await Promise.all([rpc("list_access"), rpc("list_devices")]);
      estado.acessos = Array.isArray(a.access) ? a.access : [];
      estado.aparelhos = Array.isArray(d.devices) ? d.devices : [];
    } catch (e) {
      recado(e.message || String(e), "erro");
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

  function selo(acesso) {
    if (acesso.status === "revoked") return ['<span class="adm-selo adm-selo-mal">Bloqueada</span>', "mal"];
    if (!acesso.user_id) return ['<span class="adm-selo adm-selo-espera">Sem conta</span>', "espera"];
    if (venceu(acesso.valid_until)) return ['<span class="adm-selo adm-selo-mal">Vencida</span>', "mal"];
    return ['<span class="adm-selo adm-selo-ok">Ativa</span>', "ok"];
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
      const [pastilha] = selo(a);
      const linha = document.createElement("div");
      linha.className = "adm-linha";
      linha.innerHTML = `
        <div>
          <div class="adm-linha-topo">
            <span class="adm-nome"></span>
            ${pastilha}
          </div>
          <p class="adm-dado">
            Vale até <b>${dia(a.valid_until)}</b> · ${a.max_devices || 1} computador(es)
            ${a.user_id ? "" : '<br>Os dias estão reservados, mas <b>só valem depois que existir login com este e-mail</b>.'}
          </p>
        </div>
        <div class="adm-verbos">
          <button class="adm-verbo" type="button" data-fazer="renovar">Renovar</button>
          <button class="adm-verbo" type="button" data-fazer="bloquear">Bloquear</button>
          <button class="adm-verbo adm-verbo-perigo" type="button" data-fazer="excluir">Excluir</button>
        </div>`;
      // textContent, não innerHTML: e-mail é dado de fora e não vira marcação.
      linha.querySelector(".adm-nome").textContent = texto(a.email);
      linha.querySelectorAll("[data-fazer]").forEach((bt) => {
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
        if (!confirm(`Bloquear este computador?\n\nO ATIVAVID para de abrir nele. A assinatura do cliente continua valendo nos outros.`)) return;
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
      recado(
        `${login.message || "Login pronto."} ${acesso.message || ""}`.trim(),
        acesso.pendingSignup ? "atencao" : "ok",
      );
      $("novoEmail").value = "";
      $("novaSenha").value = "";
      await carregar();
    });
  }

  // -------------------------------------------------------------------- abas

  function trocarAba(nome) {
    estado.aba = nome;
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
