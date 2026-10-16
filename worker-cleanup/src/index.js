const PREFIXES = {
  'dades_radar_dbz/': 26 * 3600 * 1000,
  'dades_radar_nimbus/': 26 * 3600 * 1000,
  'dades_radar_acumulacions/': 26 * 3600 * 1000,
};

// Només aquestes carpetes es poden esborrar amb la URL
const BORRABLES = ['radar/', 'dades_radar/', 'dades_rad/'];

async function purge(env) {
  let esborrats = 0;
  for (const [prefix, maxAge] of Object.entries(PREFIXES)) {
    const cutoff = Date.now() - maxAge;
    let cursor;
    do {
      const list = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
      const old = list.objects
        .filter((o) => !o.key.endsWith('manifest.json') && o.uploaded.getTime() < cutoff)
        .map((o) => o.key);
      if (old.length) { await env.BUCKET.delete(old); esborrats += old.length; }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  console.log(`[cleanup] esborrats ${esborrats} objectes`);
}

async function stats(env) {
  const out = {};
  let cursor;
  do {
    const l = await env.BUCKET.list({ cursor, limit: 1000 });
    for (const o of l.objects) {
      const top = o.key.includes('/') ? o.key.split('/')[0] + '/' : '(arrel)';
      const s = (out[top] ??= { objectes: 0, bytes: 0, ultima: 0 });
      s.objectes++;
      s.bytes += o.size;
      const t = o.uploaded.getTime();
      if (t > s.ultima) s.ultima = t;
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);

  for (const k of Object.keys(out)) {
    out[k].mida_MB = +(out[k].bytes / 1048576).toFixed(1);
    out[k].ultima_pujada = new Date(out[k].ultima).toISOString();
    delete out[k].bytes;
    delete out[k].ultima;
  }
  return out;
}

async function esborra(env, prefix) {
  let n = 0;
  while (true) {
    const l = await env.BUCKET.list({ prefix, limit: 1000 });
    if (!l.objects.length) break;
    await env.BUCKET.delete(l.objects.map((o) => o.key));
    n += l.objects.length;
  }
  return n;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.STATS_KEY || url.searchParams.get('key') !== env.STATS_KEY) {
      return new Response('No', { status: 403 });
    }

    const del = url.searchParams.get('esborra');
    if (del) {
      if (!BORRABLES.includes(del)) return new Response('Prefix no permès', { status: 400 });
      return Response.json({ prefix: del, esborrats: await esborra(env, del) });
    }

    return Response.json(await stats(env));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};