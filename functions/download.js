// ativavid.com/download — entrega o instalador mais recente sem expor a origem.
//
// 06/09: duas coisas mudaram aqui.
//
// 1. O repositório do código virou PRIVADO. O instalador passou a viver num
//    repositório público que só tem downloads.
//
// 2. O nome fixo `Instalar.ATIVAVID.exe` não existe mais nas releases — elas
//    saem versionadas (`Instalar.ATIVAVID.5.1.11.exe`). O link antigo era
//    `releases/latest/download/Instalar.ATIVAVID.exe`, que respondia 404, e
//    esta página devolvia "indisponível" para quem tentava baixar. Agora o
//    arquivo é DESCOBERTO: pergunta-se à API qual é a última release e pega-se
//    o primeiro `.exe` dela.
const REPO = "Usantos1/Ativavid-Instalador";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const NOME = "Instalar.ATIVAVID.exe";

async function urlDoInstalador() {
  const r = await fetch(API, {
    headers: { accept: "application/vnd.github+json", "user-agent": "ativavid-site" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!r.ok) return null;
  const dados = await r.json();
  const exe = (dados.assets || []).find(
    (a) => String(a.name || "").toLowerCase().endsWith(".exe"),
  );
  return exe ? exe.browser_download_url : null;
}

export async function onRequestGet(context) {
  const req = context.request;
  const cabecalhos = {};
  const range = req.headers.get("range");
  if (range) cabecalhos.range = range;

  let alvo;
  try {
    alvo = await urlDoInstalador();
  } catch (e) {
    alvo = null;
  }
  if (!alvo) {
    return new Response("Instalador indisponível no momento. Tente de novo em instantes.", { status: 503 });
  }

  let origem;
  try {
    origem = await fetch(alvo, { headers: cabecalhos, redirect: "follow", cf: { cacheTtl: 300 } });
  } catch (e) {
    return new Response("Instalador indisponível no momento. Tente de novo em instantes.", { status: 503 });
  }
  if (!origem.ok && origem.status !== 206) {
    return new Response("Instalador indisponível no momento. Tente de novo em instantes.", { status: 502 });
  }

  const h = new Headers();
  h.set("content-type", "application/octet-stream");
  h.set("content-disposition", `attachment; filename="${NOME}"`);
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  for (const nome of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = origem.headers.get(nome);
    if (v) h.set(nome, v);
  }
  return new Response(origem.body, { status: origem.status, headers: h });
}
