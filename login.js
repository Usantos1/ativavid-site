/* Entrar no ATIVAVID (site). Mesma conta do aplicativo.
 * ativavid_quem_sou() diz o papel de quem entrou: equipe (admin ou suporte)
 * vai ao painel; qualquer outra conta vai às aulas. Só a chave pública aqui. */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";
  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);
  const estado = { emailTroca: "" };

  function aviso(id, msg, tom) {
    const e = $(id);
    if (!msg) { e.hidden = true; return; }
    e.textContent = msg;
    if (tom) e.dataset.tom = tom; else delete e.dataset.tom;
    e.hidden = false;
  }

  async function ocupado(bt, tarefa, onde) {
    if (!bt || bt.disabled) return;
    const antes = bt.textContent;
    bt.disabled = true;
    bt.textContent = "…";
    try {
      await tarefa();
    } catch (e) {
      aviso(onde, (e && e.message) || "Não consegui concluir. Tente de novo.");
    } finally {
      bt.disabled = false;
      bt.textContent = antes;
    }
  }

  async function destinoDe() {
    const { data, error } = await sb.rpc("ativavid_quem_sou");
    if (error) throw error;
    const papel = String((data && data.papel) || "");
    return papel === "admin" || papel === "suporte" ? "/admin" : "/aulas";
  }

  async function irParaTela() {
    location.replace(await destinoDe());
  }

  function mostrarTrocar(mostrar) {
    $("formEntrar").hidden = mostrar;
    $("formTrocar").hidden = !mostrar;
    aviso("avisoTrocar", "");
    if (mostrar) $("emailTrocar").value = $("email").value.trim().toLowerCase();
  }

  async function entrar(ev) {
    ev.preventDefault();
    aviso("erroEntrar", "");
    const email = $("email").value.trim().toLowerCase();
    const senha = $("senha").value;
    if (!email || !senha) return aviso("erroEntrar", "Preencha o e-mail e a senha.");
    await ocupado($("btEntrar"), async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invalid")) throw new Error("E-mail ou senha errados.");
        if (m.includes("confirm")) throw new Error("Este e-mail ainda não foi confirmado.");
        throw new Error(error.message || "Não consegui entrar.");
      }
      await irParaTela();
    }, "erroEntrar");
  }

  function pedirCodigo(bt) {
    const email = $("emailTrocar").value.trim().toLowerCase();
    if (!email.includes("@")) return aviso("avisoTrocar", "Informe o e-mail da sua conta.");
    return ocupado(bt, async () => {
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) throw new Error(error.message || "Não consegui mandar o código.");
      estado.emailTroca = email;
      $("passoPedir").hidden = true;
      $("passoCodigo").hidden = false;
      aviso("avisoTrocar", `Se existir conta com ${email}, o código chega em instantes. Olhe também o spam.`, "ok");
      $("codigo").focus();
    }, "avisoTrocar");
  }

  function trocarSenha(bt) {
    const codigo = $("codigo").value.replace(/\D/g, "");
    const senha = $("senhaNova").value;
    if (codigo.length < 4) return aviso("avisoTrocar", "Digite o código que chegou no e-mail.");
    if (senha.length < 6) return aviso("avisoTrocar", "A senha nova precisa de pelo menos 6 caracteres.");
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
      await irParaTela();
    }, "avisoTrocar");
  }

  // Já entrou antes (sessão guardada no navegador): não pede a senha de novo.
  async function jaEntrou() {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return;
    try {
      await irParaTela();
    } catch (e) {
      await sb.auth.signOut();
    }
  }

  $("formEntrar").addEventListener("submit", entrar);
  $("btEsqueci").addEventListener("click", () => mostrarTrocar(true));
  $("btVoltar").addEventListener("click", () => mostrarTrocar(false));
  $("btPedirCodigo").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btReenviar").addEventListener("click", (e) => pedirCodigo(e.currentTarget));
  $("btTrocar").addEventListener("click", (e) => trocarSenha(e.currentTarget));
  jaEntrou();
})();
