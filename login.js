/* Entrar no ATIVAVID (site).
 * Quem decide para onde a pessoa vai é o Postgres: ativavid_quem_sou() diz o
 * papel de quem entrou. Equipe (admin ou suporte) vai ao painel; qualquer outra
 * conta vai à área de aulas. Sem chave de serviço aqui: só a chave pública. */
(() => {
  "use strict";

  const URL_ = "https://koolbdivdqnqxlukctqu.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvb2xiZGl2ZHFucXhsdWtjdHF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzM5NTUsImV4cCI6MjEwMjE0OTk1NX0.PV9L4Ign4PfLAd2mgwQVVIlGr9AxbP54Gt2-BRLma_s";
  const sb = window.supabase.createClient(URL_, ANON);
  const $ = (id) => document.getElementById(id);

  const recado = (texto) => { $("recado").textContent = texto || ""; };

  async function destinoDe() {
    const { data, error } = await sb.rpc("ativavid_quem_sou");
    if (error) throw error;
    const papel = String((data && data.papel) || "");
    return papel === "admin" || papel === "suporte" ? "/admin" : "/aulas";
  }

  // Já entrou antes (sessão guardada no navegador): não pede a senha de novo.
  async function jaEntrou() {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return;
    try {
      location.replace(await destinoDe());
    } catch (e) {
      await sb.auth.signOut();
    }
  }

  async function entrar(ev) {
    ev.preventDefault();
    recado("");
    const email = $("email").value.trim().toLowerCase();
    const senha = $("senha").value;
    if (!email || !senha) {
      recado("Preencha o e-mail e a senha.");
      return;
    }
    $("btEntrar").disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invalid")) throw new Error("E-mail ou senha errados.");
        if (m.includes("confirm")) throw new Error("Este e-mail ainda não foi confirmado.");
        throw new Error(error.message || "Não consegui entrar.");
      }
      location.replace(await destinoDe());
    } catch (e) {
      recado((e && e.message) || "Não consegui entrar. Tente de novo.");
      $("btEntrar").disabled = false;
    }
  }

  $("formLogin").addEventListener("submit", entrar);
  jaEntrou();
})();
