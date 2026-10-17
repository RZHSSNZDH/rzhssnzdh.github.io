/*
 * Ganjoor API client and random-poem picker.
 * JavaScript port of ganjoorand/api.py (GGanjoorand, GPL-3.0-or-later).
 *
 * Accepted input (same as the original app):
 *   - full URL:  https://ganjoor.net/hafez/ghazal/
 *   - path:      hafez/ghazal   or   hafez ghazal
 *   - poet:      hafez   or   حافظ   or   moulavi
 *   - empty:     a random poem from any poet
 */

export const API_ROOT = "https://api.ganjoor.net/api/ganjoor";
export const SITE_ROOT = "https://ganjoor.net";
const PROXY_ROOT = "/gapi"; // provided by server.py
const MAX_DEPTH = 12;
const POETS_TTL = 24 * 3600 * 1000;

export class GanjoorError extends Error {}

const MSG = {
  notFound: "صفحه پیدا نشد. نشانی یا نام شاعر را بررسی کنید.",
  offline: "اتصال به گنجور برقرار نشد. اینترنت را بررسی کنید.",
  badJson: "پاسخ گنجور قابل خواندن نبود.",
  noPoem: "در این بخش شعری پیدا نشد.",
  noPoet: "شاعر یا بخش پیدا نشد. مثلاً hafez یا حافظ یا hafez/ghazal",
  cors:
    "مرورگر اجازهٔ دسترسی مستقیم به API گنجور را نمی‌دهد. " +
    "برنامه را با «python3 server.py» اجرا کنید.",
};

/* ------------------------------------------------------------------ */
/* Transport: direct first, then the local proxy if CORS blocks us     */
/* ------------------------------------------------------------------ */

let useProxy = false;

async function request(url, signal) {
  return fetch(url, { headers: { Accept: "application/json" }, signal });
}

function isAbort(err) {
  return err && err.name === "AbortError";
}

async function viaProxy(path, signal) {
  let res;
  try {
    res = await request(PROXY_ROOT + path, signal);
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new GanjoorError(MSG.offline);
  }
  // A plain static server answers /gapi/* with its own 404 page.
  if (!res.headers.get("X-Ganjoor-Proxy")) throw new GanjoorError(MSG.cors);
  useProxy = true;
  return res;
}

export async function apiGet(path, signal) {
  let res;
  if (useProxy) {
    res = await viaProxy(path, signal);
  } else {
    try {
      res = await request(API_ROOT + path, signal);
    } catch (err) {
      if (isAbort(err)) throw err;
      // Network failure or CORS rejection: try the local proxy.
      const http = String(globalThis.location?.protocol || "").startsWith("http");
      if (!http) throw new GanjoorError(MSG.cors);
      res = await viaProxy(path, signal);
    }
  }
  if (res.status === 404) throw new GanjoorError(MSG.notFound);
  if (!res.ok) throw new GanjoorError(`پاسخ گنجور: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new GanjoorError(MSG.badJson);
  }
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

/** Normalise Persian/Arabic letters so matching is forgiving. */
export function fold(text) {
  return (text || "")
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک")
    .replaceAll("\u200c", "")
    .replaceAll("ـ", "")
    .trim()
    .toLowerCase();
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const trimSlashes = (s) => s.replace(/^\/+|\/+$/g, "");
const isUrl = (s) => /^https?:\/\//i.test(s);

/** Normalise user input the same way the original CLI did. */
export function cleanUrl(raw) {
  const text = (raw || "").trim();
  const m = text.match(/^(https?:\/\/[^/\s]+)(.*)$/i);
  if (m) {
    const path = m[2].replace(/\s+/g, "/").replace(/\/+/g, "/") || "/";
    return m[1] + path;
  }
  return trimSlashes(text.replace(/\s+/g, "/").replace(/\/+/g, "/"));
}

function pathFromInput(cleaned) {
  if (isUrl(cleaned)) {
    let p;
    try {
      p = decodeURIComponent(new URL(cleaned).pathname);
    } catch {
      p = new URL(cleaned).pathname;
    }
    return p.replace(/\/+$/, "") || "/";
  }
  return "/" + trimSlashes(cleaned);
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

function poemFromPayload(data) {
  const verses = [];
  for (const item of data.verses || []) {
    const text = (item.text || "").trim();
    if (!text) continue;
    verses.push({
      text,
      coupletIndex: Number(item.coupletIndex || 0),
      position: item.versePosition != null ? Number(item.versePosition) : 0,
    });
  }

  const recitations = [];
  for (const item of data.recitations || []) {
    if (item.mp3Url) {
      recitations.push({ artist: item.audioArtist || "", mp3Url: item.mp3Url });
    }
  }

  const metre = (data.sections?.[0]?.ganjoorMetre) || {};
  const rhythm = metre.rhythm || "";

  let poetName = "";
  const poet = data.category && typeof data.category === "object" ? data.category.poet : null;
  if (poet && typeof poet === "object") poetName = poet.nickname || poet.name || "";
  if (!poetName && data.fullTitle) poetName = String(data.fullTitle).split("»")[0].trim();

  const fullUrl = data.fullUrl || "";
  const fullTitle = data.fullTitle || data.title || "";

  return {
    id: Number(data.id),
    title: data.title || "",
    fullTitle,
    fullUrl,
    siteUrl: SITE_ROOT + fullUrl,
    verses,
    rhythm,
    poetName,
    recitations,
  };
}

/** Plain text of a poem, with a blank line between couplets. */
export function plainText(poem) {
  const lines = [];
  let current = -1;
  for (const v of poem.verses) {
    if (v.coupletIndex !== current && lines.length) lines.push("");
    current = v.coupletIndex;
    lines.push(v.text);
  }
  return lines.join("\n").trim();
}

export function copyText(poem) {
  return `${poem.fullTitle}\n\n${plainText(poem)}\n\n${poem.siteUrl}`;
}

/* ------------------------------------------------------------------ */
/* Poets                                                               */
/* ------------------------------------------------------------------ */

export async function listPoets(signal) {
  try {
    const cached = JSON.parse(localStorage.getItem("gj.poets") || "null");
    if (cached && Date.now() - cached.at < POETS_TTL && cached.data?.length) return cached.data;
  } catch {
    /* ignore */
  }
  const data = await apiGet("/poets", signal);
  const poets = data.map((item) => ({
    id: Number(item.id),
    name: item.name || "",
    nickname: item.nickname || item.name || "",
    slug: trimSlashes(item.fullUrl || ""),
    pinOrder: Number(item.pinOrder || 0),
  }));
  try {
    localStorage.setItem("gj.poets", JSON.stringify({ at: Date.now(), data: poets }));
  } catch {
    /* ignore */
  }
  return poets;
}

export function pinnedPoets(poets) {
  return poets
    .filter((p) => p.pinOrder > 0)
    .sort((a, b) => a.pinOrder - b.pinOrder)
    .slice(0, 10);
}

export function findPoet(query, poets) {
  const needle = fold(query);
  if (!needle) return null;
  return (
    poets.find((p) => fold(p.slug) === needle) ||
    poets.find((p) => fold(p.nickname) === needle || fold(p.name) === needle) ||
    poets.find(
      (p) =>
        fold(p.nickname).includes(needle) ||
        fold(p.name).includes(needle) ||
        fold(p.slug).includes(needle),
    ) ||
    null
  );
}

/* ------------------------------------------------------------------ */
/* Fetching poems                                                      */
/* ------------------------------------------------------------------ */

export async function getPoemById(id, signal) {
  return poemFromPayload(await apiGet(`/poem/${id}`, signal));
}

export async function getRandomPoem(poetId, signal) {
  const path = "/poem/random" + (poetId ? `?poetId=${poetId}` : "");
  const stub = poemFromPayload(await apiGet(path, signal));
  // /poem/random omits recitations, so load the full record.
  return getPoemById(stub.id, signal);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function randomFromCat(catId, signal, depth = 0) {
  if (depth > MAX_DEPTH) throw new GanjoorError(MSG.noPoem);
  const payload = await apiGet(`/cat/${catId}`, signal);
  const cat = payload.cat || payload;
  const poems = cat.poems || [];
  const children = cat.children || [];
  if (poems.length) return getPoemById(Number(pick(poems).id), signal);
  if (children.length) return randomFromCat(Number(pick(children).id), signal, depth + 1);
  throw new GanjoorError(MSG.noPoem);
}

function childMatching(children, token) {
  const needle = fold(token);
  if (!needle) return null;
  const slugOf = (c) => String(c.urlSlug || c.fullUrl || "").split("/").pop();
  return (
    children.find((c) => fold(slugOf(c)) === needle || fold(c.title || "") === needle) ||
    children.find(
      (c) => fold(c.urlSlug || "").includes(needle) || fold(c.title || "").includes(needle),
    ) ||
    null
  );
}

/** Resolve a user query to one random (or exact) poem. */
export async function pickRandomPoem(userInput, poets, signal) {
  const cleaned = cleanUrl(userInput);
  if (!cleaned) return getRandomPoem(null, signal);

  const known = poets && poets.length ? poets : await listPoets(signal);
  const path = pathFromInput(cleaned);

  let page = null;
  try {
    page = await apiGet(`/page?url=${encPath(path)}`, signal);
  } catch (err) {
    if (!(err instanceof GanjoorError)) throw err;
  }

  if (page) {
    const type = Number(page.ganjoorPageType || 0);
    if (type === 3 && page.poem) return poemFromPayload(page.poem);
    const poc = page.poetOrCat || {};
    const poet = poc.poet || {};
    const cat = poc.cat || {};
    if (type === 1 && poet.id) return getRandomPoem(Number(poet.id), signal);
    if (cat.id) return randomFromCat(Number(cat.id), signal);
  }

  let tokens = trimSlashes(cleaned).split(/[/\s]+/).filter(Boolean);
  let poet = tokens.length ? findPoet(tokens[0], known) : null;
  if (!poet && tokens.length) {
    // The whole string might be a Persian nickname with spaces.
    poet = findPoet(tokens.join(" "), known);
    tokens = [];
  }
  if (!poet) throw new GanjoorError(MSG.noPoet);
  if (tokens.length <= 1) return getRandomPoem(poet.id, signal);

  const poetPage = await apiGet(`/page?url=${encPath("/" + poet.slug)}`, signal);
  let children = poetPage.poetOrCat?.cat?.children || [];
  let current = null;
  let remaining = tokens.slice(1);
  while (remaining.length) {
    const match = childMatching(children, remaining[0]);
    if (!match) break;
    current = match;
    remaining = remaining.slice(1);
    if (current.id) {
      const full = await apiGet(`/cat/${Number(current.id)}`, signal);
      children = full.cat?.children || [];
    }
  }
  if (current && current.id) return randomFromCat(Number(current.id), signal);
  return getRandomPoem(poet.id, signal);
}
