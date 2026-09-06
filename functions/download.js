// ativavid.com/download — entrega o instalador mais recente sem expor a origem.
//
// 06/09, duas mudanças e uma lição.
//
// 1. O repositório do código virou PRIVADO. O instalador passou a viver num
//    repositório público que só tem downloads.
//
// 2. O link de nome fixo (`releases/latest/download/Instalar.ATIVAVID.exe`)
//    respondia 404: as releases saem versionadas
//    (`Instalar.ATIVAVID.5.1.11.exe`) e nenhuma tinha aquele nome. Esta
//    página dizia "indisponível" havia várias versões, sem ninguém ver. Agora
//    o build gera a cópia de nome fixo e toda release leva as duas.
//
// Por isso a ordem aqui é: PRIMEIRO o nome fixo, que é um redirecionamento
// simples e não gasta cota de API; se ele faltar, pergunta-se à API qual é a
// última release e pega-se o primeiro `.exe`. A API é o plano B de propósito:
// ela é limitada por IP para quem chama sem credencial, e o Cloudflare sai
// por IPs compartilhados — depender dela a cada visita seria trocar um
// problema silencioso por outro.
const REPO = "Usantos1/Ativavid-Instalador";
const FIXO = `https://github.com/${REPO}/releases/latest/download/Instalar.ATIVAVID.exe`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const NOME = "Instalar.ATIVAVID.exe";

async function pelaApi() {
  const r = await fetch(API, {
    headers: { accept: "application/vnd.github+json", "user-agent": "ativavid-site" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!r.ok) return null;
  const dados = await r.json();
  const exe = (dados.assets || []).find(
    (a) => String(a.name || "").toLowerCase().endsWith(".exe"),
  );
  return exe ? exe.browser_download_url : null;
}

async function buscar(url, cabecalhos) {
  try {
    return await fetch(url, { headers: cabecalhos, redirect: "follow", cf: { cacheTtl: 300 } });
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  const req = context.request;
  const cabecalhos = {};
  const range = req.headers.get("range");
  if (range) cabecalhos.range = range;

  let origem = await buscar(FIXO, cabecalhos);
  if (!origem || (!origem.ok && origem.status !== 206)) {
    let alvo = null;
    try {
      alvo = await pelaApi();
    } catch (e) {
      alvo = null;
    }
    origem = alvo ? await buscar(alvo, cabecalhos) : null;
  }
  if (!origem || (!origem.ok && origem.status !== 206)) {
    return new Response("Instalador indisponível no momento. Tente de novo em instantes.", { status: 503 });
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
