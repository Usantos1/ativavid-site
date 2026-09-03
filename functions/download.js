// ativavid.com/download — entrega o instalador mais recente sem expor a origem.
const ORIGEM = "https://github.com/Usantos1/Ativavid/releases/latest/download/Instalar.ATIVAVID.exe";
const NOME = "Instalar.ATIVAVID.exe";

export async function onRequestGet(context) {
  const req = context.request;
  const cabecalhos = {};
  const range = req.headers.get("range");
  if (range) cabecalhos.range = range;

  let origem;
  try {
    origem = await fetch(ORIGEM, { headers: cabecalhos, redirect: "follow", cf: { cacheTtl: 300 } });
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
  for (const k of ["content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const v = origem.headers.get(k);
    if (v) h.set(k, v);
  }
  return new Response(origem.body, { status: origem.status, headers: h });
}

export async function onRequestHead(context) {
  const r = await onRequestGet(context);
  return new Response(null, { status: r.status, headers: r.headers });
}
