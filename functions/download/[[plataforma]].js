// ativavid.com/download — entrega o instalador mais recente sem expor a origem.
//
//   /download           escolhe pelo sistema de quem pede (User-Agent)
//   /download/windows   Instalar.ATIVAVID.exe
//   /download/mac       ATIVAVID-<versão>-mac.dmg (Mac com chip Apple)
//   /download/mac-intel ATIVAVID-<versão>-macos-intel.dmg (Mac Intel, desde a 5.4.34)
//   /download/info      JSON com versão e tamanho de cada um (a página
//                       /baixar mostra o tamanho real e esconde o que não existe)
//
// A ordem do Windows continua a de 06/09: PRIMEIRO o nome fixo, que é um
// redirecionamento simples e não gasta cota de API; se ele faltar, a API.
// A API é limitada por IP para quem chama sem credencial e o Cloudflare sai
// por IPs compartilhados, por isso a resposta dela fica 10 min em cache.
//
// O Mac não tem nome fixo: o .dmg sai versionado e nem toda release o leva
// (o do Windows sai mais vezes). Procura-se nas releases mais novas a
// primeira que tenha um .dmg. Os dois .dmg se distinguem pelo nome: o da
// Intel leva "intel"; o do chip Apple é todo .dmg sem "intel". O pedido de
// /download sem sistema, vindo de um Mac, recebe o do chip Apple: o servidor
// não sabe o chip, e a /baixar é quem pergunta ao navegador.
//
// O .dmg tem centenas de MB. O corpo vai em fluxo (origem.body), sem passar pela
// memória da função, e o Range é repassado: download interrompido continua.
const REPO = "Usantos1/Ativavid-Instalador";
const FIXO_WIN = `https://github.com/${REPO}/releases/latest/download/Instalar.ATIVAVID.exe`;
const API_RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=15`;
const NOME_WIN = "Instalar.ATIVAVID.exe";

async function releases() {
  const r = await fetch(API_RELEASES, {
    headers: { accept: "application/vnd.github+json", "user-agent": "ativavid-site" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!r.ok) return [];
  const lista = await r.json();
  return Array.isArray(lista) ? lista.filter((x) => !x.draft && !x.prerelease) : [];
}

const EXE = (nome) => nome.endsWith(".exe");
const MAC_CHIP = (nome) => nome.endsWith(".dmg") && !nome.includes("intel");
const MAC_INTEL = (nome) => nome.endsWith(".dmg") && nome.includes("intel");

function acharArquivo(lista, combina) {
  for (const rel of lista) {
    const a = (rel.assets || []).find((x) => combina(String(x.name || "").toLowerCase()));
    if (a) {
      return {
        url: a.browser_download_url,
        nome: a.name,
        tamanho: a.size,
        // A versão vem do NOME do arquivo quando ele traz uma: em 03/10 o
        // ATIVAVID-5.4.29-mac.dmg foi anexado à release v5.4.19, e a tag mentiria.
        versao: (String(a.name).match(/(\d+\.\d+\.\d+)/) || [])[1] || String(rel.tag_name || "").replace(/^v/, ""),
        data: a.updated_at || rel.published_at,
      };
    }
  }
  return null;
}

async function buscar(url, cabecalhos) {
  try {
    return await fetch(url, { headers: cabecalhos, redirect: "follow", cf: { cacheTtl: 300 } });
  } catch (e) {
    return null;
  }
}

const serve = (o) => o && (o.ok || o.status === 206);

function sistemaDoPedido(req) {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  const dica = (req.headers.get("sec-ch-ua-platform") || "").toLowerCase();
  if (dica.includes("mac") || (/macintosh|mac os x/.test(ua) && !/iphone|ipad/.test(ua))) return "mac";
  return "windows";
}

function indisponivel(texto) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Download indisponível — ATIVAVID</title><meta name="robots" content="noindex">` +
    `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10;color:#eef1f5;font:17px/1.55 system-ui,sans-serif;text-align:center;padding:24px">` +
    `<main><h1 style="font-size:26px;margin:0 0 10px">${texto}</h1>` +
    `<p style="color:#a3abb6;margin:0 0 24px">Tente de novo em instantes. Se continuar, fale com a gente pelo Instagram @ativavid.</p>` +
    `<a href="/baixar" style="display:inline-block;background:#e60004;color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px">Voltar para o download</a></main>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function entregar(origem, nome, tipo) {
  const h = new Headers();
  h.set("content-type", tipo);
  h.set("content-disposition", `attachment; filename="${nome}"`);
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("x-robots-tag", "noindex");
  for (const k of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = origem.headers.get(k);
    if (v) h.set(k, v);
  }
  return new Response(origem.body, { status: origem.status, headers: h });
}

async function windows(cabecalhos) {
  let origem = await buscar(FIXO_WIN, cabecalhos);
  if (!serve(origem)) {
    const exe = acharArquivo(await releases().catch(() => []), EXE);
    origem = exe ? await buscar(exe.url, cabecalhos) : null;
  }
  if (!serve(origem)) return indisponivel("O instalador do Windows está indisponível no momento.");
  return entregar(origem, NOME_WIN, "application/octet-stream");
}

async function mac(cabecalhos, intel) {
  const qual = intel ? "do Mac Intel" : "do Mac";
  const dmg = acharArquivo(await releases().catch(() => []), intel ? MAC_INTEL : MAC_CHIP);
  if (!dmg) return indisponivel(`O instalador ${qual} ainda não foi publicado.`);
  const origem = await buscar(dmg.url, cabecalhos);
  if (!serve(origem)) return indisponivel(`O instalador ${qual} está indisponível no momento.`);
  return entregar(origem, dmg.nome, "application/x-apple-diskimage");
}

async function info() {
  const lista = await releases().catch(() => []);
  const tira = (a) => (a ? { versao: a.versao, tamanho: a.tamanho, data: a.data } : null);
  return new Response(
    JSON.stringify({
      windows: tira(acharArquivo(lista, EXE)),
      mac: tira(acharArquivo(lista, MAC_CHIP)),
      macIntel: tira(acharArquivo(lista, MAC_INTEL)),
    }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } },
  );
}

export async function onRequestGet(context) {
  const req = context.request;
  const p = context.params.plataforma;
  const alvo = String((Array.isArray(p) ? p[0] : p) || "").toLowerCase();
  if (alvo === "info") return info();

  const cabecalhos = {};
  const range = req.headers.get("range");
  if (range) cabecalhos.range = range;

  if (alvo === "mac-intel" || alvo === "intel") return mac(cabecalhos, true);
  const sistema = alvo === "mac" || alvo === "windows" ? alvo : sistemaDoPedido(req);
  return sistema === "mac" ? mac(cabecalhos, false) : windows(cabecalhos);
}
