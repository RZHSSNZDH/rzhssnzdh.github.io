/* گنجورند — Ganjoorand web UI (GPL-3.0-or-later) */

import {
  GanjoorError,
  copyText,
  getPoemById,
  listPoets,
  pickRandomPoem,
  pinnedPoets,
} from "./api.js";

const $ = (sel, root = document) => root.querySelector(sel);
const fa = new Intl.NumberFormat("fa-IR");

/* ---------------------------------------------------------------- state */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};

const state = {
  poets: [],
  poem: null,
  history: store.get("gj.history", []),
  favs: store.get("gj.favs", []),
  controller: null,
  tab: "favs",
  booted: false,
};

const SIZES = [1.15, 1.3, 1.5, 1.7, 1.95, 2.3];
let sizeIdx = Math.min(Math.max(store.get("gj.size", 2), 0), SIZES.length - 1);

/* ------------------------------------------------------------- elements */

const el = {
  form: $("#searchForm"),
  input: $("#q"),
  go: $("#goBtn"),
  suggest: $("#suggest"),
  chips: $("#chips"),
  notice: $("#notice"),
  card: $("#poem"),
  content: $(".poem-content"),
  kicker: $("#kicker"),
  title: $("#poemTitle"),
  verses: $("#verses"),
  metre: $("#metre"),
  recNote: $("#recNote"),
  again: $("#btnAgain"),
  fav: $("#btnFav"),
  copy: $("#btnCopy"),
  site: $("#btnSite"),
  player: $("#player"),
  play: $("#btnPlay"),
  playIcon: $("#playIcon"),
  seek: $("#seek"),
  time: $("#time"),
  artist: $("#artist"),
  drawer: $("#drawer"),
  drawerList: $("#drawerList"),
  tabFavs: $("#tabFavs"),
  tabHist: $("#tabHist"),
  toasts: $("#toasts"),
  themeIcon: $("#themeIcon"),
};

/* ---------------------------------------------------------------- utils */

function toast(text) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = text;
  el.toasts.append(node);
  setTimeout(() => node.remove(), 2600);
}

function showNotice(text) {
  el.notice.textContent = text || "";
  el.notice.hidden = !text;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      /* ignore */
    }
    ta.remove();
    return ok;
  }
}

const isTyping = () => {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
};

/* ---------------------------------------------------------------- theme */

const media = matchMedia("(prefers-color-scheme: dark)");

function effectiveDark() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === "dark" : media.matches;
}

function syncThemeIcon() {
  el.themeIcon.setAttribute("href", effectiveDark() ? "#i-sun" : "#i-moon");
}

$("#btnTheme").addEventListener("click", () => {
  const next = effectiveDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("gj.theme", next);
  syncThemeIcon();
});
media.addEventListener("change", syncThemeIcon);
syncThemeIcon();

/* ------------------------------------------------------------ font size */

function applySize() {
  document.documentElement.style.setProperty("--verse-size", `${SIZES[sizeIdx]}rem`);
  store.set("gj.size", sizeIdx);
}
$("#btnBigger").addEventListener("click", () => {
  sizeIdx = Math.min(sizeIdx + 1, SIZES.length - 1);
  applySize();
});
$("#btnSmaller").addEventListener("click", () => {
  sizeIdx = Math.max(sizeIdx - 1, 0);
  applySize();
});
applySize();

/* -------------------------------------------------------------- loading */

function setLoading(on) {
  el.card.classList.toggle("is-loading", on);
  el.card.setAttribute("aria-busy", String(on));
  el.go.disabled = on;
  el.again.disabled = on;
}

async function run(task, query = "") {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const { signal } = controller;

  showNotice("");
  setLoading(true);
  try {
    const poem = await task(signal);
    if (signal.aborted) return;
    remember(query);
    renderPoem(poem);
  } catch (err) {
    if (err?.name === "AbortError") return;
    showNotice(err instanceof GanjoorError ? err.message : `خطا: ${err?.message || err}`);
  } finally {
    if (state.controller === controller) setLoading(false);
  }
}

function requestPoem({ force = false } = {}) {
  let query = el.input.value.trim();
  if (!query && !force && state.history.length) {
    query = state.history[0]; // empty input repeats the last search
    el.input.value = query;
  }
  hideSuggest();
  return run((signal) => pickRandomPoem(query, state.poets, signal), query);
}

function remember(query) {
  const q = query.trim();
  if (!q) return;
  state.history = [q, ...state.history.filter((h) => h !== q)].slice(0, 40);
  store.set("gj.history", state.history);
}

/* -------------------------------------------------------------- render */

function renderVerses(poem) {
  const groups = new Map();
  for (const v of poem.verses) {
    if (!groups.has(v.coupletIndex)) groups.set(v.coupletIndex, []);
    groups.get(v.coupletIndex).push(v);
  }

  const frag = document.createDocumentFragment();
  let n = 0;
  for (const idx of [...groups.keys()].sort((a, b) => a - b)) {
    const lines = groups.get(idx);
    const div = document.createElement("div");
    div.className = "couplet";
    div.style.setProperty("--i", n++);

    const line = (v) => {
      const s = document.createElement("span");
      s.className = "m";
      s.textContent = v.text;
      return s;
    };

    const only = lines.length === 1 ? lines[0] : null;
    if (only && only.position === 5) {
      div.classList.add("note");
    } else if (only && only.position === 4) {
      div.classList.add("prose");
    }

    if (lines.length === 1) {
      div.classList.add("single");
      div.append(line(lines[0]));
    } else if (lines.length === 2) {
      const [a, b] = [...lines].sort((x, y) => x.position - y.position);
      const classic = a.position === 0 && b.position === 1;
      div.classList.add(classic ? "pair" : "stack");
      div.append(line(a), line(b));
    } else {
      div.classList.add("stack");
      for (const v of lines) div.append(line(v));
    }
    frag.append(div);
  }
  el.verses.replaceChildren(frag);
}

function renderPoem(poem) {
  state.poem = poem;

  const parts = poem.fullTitle.split("»").map((s) => s.trim()).filter(Boolean);
  const title = parts.pop() || poem.title || "";
  el.kicker.textContent = parts.join("  ›  ") || poem.poetName || "گنجور";
  el.title.textContent = title;
  renderVerses(poem);

  el.metre.hidden = !poem.rhythm;
  el.metre.textContent = poem.rhythm ? `وزن: ${poem.rhythm}` : "";

  const artists = poem.recitations.slice(0, 3).map((r) => r.artist).filter(Boolean);
  el.recNote.hidden = !artists.length;
  el.recNote.textContent = artists.length
    ? `${fa.format(poem.recitations.length)} خوانش · ${artists.join(" · ")}`
    : "";

  el.card.classList.remove("is-empty");
  el.content.hidden = false;
  el.site.href = poem.siteUrl;
  document.title = `${title} — گنجورند`;
  try {
    history.replaceState(null, "", `#p${poem.id}`);
  } catch {
    /* file:// etc. */
  }

  syncFav();
  setupPlayer(poem);
  highlightChip();
  if (state.booted) el.card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------------------------------------------------------- chips */

function renderChips() {
  const frag = document.createDocumentFragment();
  const make = (label, slug, cls = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip ${cls}`.trim();
    b.textContent = label;
    b.dataset.slug = slug;
    b.style.setProperty("--i", frag.childNodes.length);
    return b;
  };
  for (const p of pinnedPoets(state.poets)) frag.append(make(p.nickname, p.slug));
  frag.append(make("تصادفی از همه", "*", "ghost-chip"));
  el.chips.replaceChildren(frag);
  highlightChip();
}

function highlightChip() {
  const q = el.input.value.trim().toLowerCase();
  for (const chip of el.chips.children) {
    chip.classList.toggle("active", !!q && chip.dataset.slug.toLowerCase() === q);
  }
}

el.chips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.slug === "*") {
    el.input.value = "";
    requestPoem({ force: true });
  } else {
    el.input.value = chip.dataset.slug;
    requestPoem();
  }
});

/* ---------------------------------------------------- history suggestions */

let suggestIdx = -1;

function showSuggest() {
  const q = el.input.value.trim().toLowerCase();
  const items = state.history.filter((h) => h.toLowerCase().includes(q) && h.toLowerCase() !== q).slice(0, 6);
  if (!items.length) return hideSuggest();
  suggestIdx = -1;
  const frag = document.createDocumentFragment();
  for (const text of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<svg class="i"><use href="#i-clock"/></svg><span></span>';
    $("span", b).textContent = text;
    b.dataset.q = text;
    frag.append(b);
  }
  el.suggest.replaceChildren(frag);
  el.suggest.hidden = false;
}

function hideSuggest() {
  el.suggest.hidden = true;
  suggestIdx = -1;
}

el.input.addEventListener("focus", showSuggest);
el.input.addEventListener("input", () => {
  el.input.dir = el.input.value ? "auto" : "rtl"; // keep the placeholder reading right-to-left
  showSuggest();
  highlightChip();
});
el.input.addEventListener("blur", () => setTimeout(hideSuggest, 120));
el.input.addEventListener("keydown", (e) => {
  const buttons = [...el.suggest.children];
  if (e.key === "Escape") return hideSuggest();
  if (el.suggest.hidden || !buttons.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggestIdx = (suggestIdx + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((b, i) => b.setAttribute("aria-selected", String(i === suggestIdx)));
  } else if (e.key === "Enter" && suggestIdx >= 0) {
    e.preventDefault();
    el.input.value = buttons[suggestIdx].dataset.q;
    requestPoem();
  }
});
el.suggest.addEventListener("mousedown", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  e.preventDefault();
  el.input.value = b.dataset.q;
  requestPoem();
});

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  requestPoem();
});

/* ------------------------------------------------------------ favourites */

const isFav = (id) => state.favs.some((f) => f.id === id);

function syncFav() {
  const on = state.poem && isFav(state.poem.id);
  el.fav.setAttribute("aria-pressed", String(!!on));
  $(".lbl", el.fav).textContent = on ? "نشان‌شده" : "نشان";
}

el.fav.addEventListener("click", () => {
  const p = state.poem;
  if (!p) return toast("هنوز شعری نیست.");
  if (isFav(p.id)) {
    state.favs = state.favs.filter((f) => f.id !== p.id);
    toast("از نشان‌شده‌ها برداشته شد.");
  } else {
    state.favs = [{ id: p.id, title: p.fullTitle, poet: p.poetName }, ...state.favs];
    toast("نشان شد.");
  }
  store.set("gj.favs", state.favs);
  syncFav();
  if (el.drawer.open) renderDrawer();
});

el.copy.addEventListener("click", async () => {
  if (!state.poem) return toast("هنوز شعری نیست.");
  toast((await copyToClipboard(copyText(state.poem))) ? "شعر رونوشت شد." : "رونوشت ممکن نشد.");
});

el.again.addEventListener("click", () => requestPoem());

/* ---------------------------------------------------------------- drawer */

function renderDrawer() {
  const favs = state.tab === "favs";
  el.tabFavs.setAttribute("aria-selected", String(favs));
  el.tabHist.setAttribute("aria-selected", String(!favs));
  const list = favs ? state.favs : state.history;
  const frag = document.createDocumentFragment();

  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty-li";
    li.textContent = favs ? "هنوز شعری را نشان نکرده‌اید." : "تاریخچه خالی است.";
    frag.append(li);
  }
  for (const item of list) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    if (favs) {
      b.dataset.id = item.id;
      b.textContent = item.title;
      if (item.poet) {
        const sub = document.createElement("span");
        sub.className = "sub";
        sub.textContent = item.poet;
        b.append(sub);
      }
    } else {
      b.dataset.q = item;
      b.textContent = item;
      b.dir = "auto";
    }
    li.append(b);
    frag.append(li);
  }
  el.drawerList.replaceChildren(frag);
  $("#clearBtn").hidden = !list.length;
}

$("#btnLibrary").addEventListener("click", () => {
  renderDrawer();
  el.drawer.showModal();
});
$("#drawerClose").addEventListener("click", () => el.drawer.close());
el.drawer.addEventListener("click", (e) => {
  if (e.target === el.drawer) el.drawer.close();
});
el.tabFavs.addEventListener("click", () => { state.tab = "favs"; renderDrawer(); });
el.tabHist.addEventListener("click", () => { state.tab = "hist"; renderDrawer(); });

$("#clearBtn").addEventListener("click", () => {
  if (state.tab === "favs") {
    state.favs = [];
    store.set("gj.favs", []);
    syncFav();
  } else {
    state.history = [];
    store.set("gj.history", []);
  }
  renderDrawer();
});

el.drawerList.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  el.drawer.close();
  if (b.dataset.id) {
    run((signal) => getPoemById(Number(b.dataset.id), signal));
  } else {
    el.input.value = b.dataset.q;
    requestPoem();
  }
});

/* ----------------------------------------------------------------- audio */

const audio = new Audio();
audio.preload = "none";

const fmtTime = (s) => {
  if (!Number.isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${fa.format(m)}:${[...sec].map((d) => fa.format(Number(d))).join("")}`;
};

function setPlayIcon(playing) {
  el.playIcon.setAttribute("href", playing ? "#i-pause" : "#i-play");
  el.play.setAttribute("aria-label", playing ? "توقف خوانش" : "پخش خوانش");
}

function resetAudio() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  el.seek.value = 0;
  el.seek.style.setProperty("--p", "0%");
  el.time.textContent = fmtTime(0);
  setPlayIcon(false);
}

function setupPlayer(poem) {
  resetAudio();
  const recs = poem.recitations;
  el.player.hidden = !recs.length;
  el.artist.replaceChildren(
    ...recs.map((r, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.artist || `خوانش ${fa.format(i + 1)}`;
      return o;
    }),
  );
  el.artist.hidden = recs.length < 2;
}

function loadRecitation() {
  const rec = state.poem?.recitations[Number(el.artist.value) || 0];
  if (rec) audio.src = rec.mp3Url;
}

async function togglePlay() {
  if (!state.poem?.recitations.length) return;
  if (!audio.src) loadRecitation();
  try {
    if (audio.paused) await audio.play();
    else audio.pause();
  } catch (err) {
    setPlayIcon(false);
    toast("پخش خوانش ممکن نشد.");
  }
}

el.play.addEventListener("click", togglePlay);
el.artist.addEventListener("change", () => {
  const wasPlaying = !audio.paused;
  loadRecitation();
  if (wasPlaying) audio.play().catch(() => setPlayIcon(false));
});
audio.addEventListener("play", () => setPlayIcon(true));
audio.addEventListener("pause", () => setPlayIcon(false));
audio.addEventListener("ended", () => {
  setPlayIcon(false);
  el.seek.value = 0;
  el.seek.style.setProperty("--p", "0%");
});
audio.addEventListener("error", () => {
  if (audio.getAttribute("src")) toast("بارگیری خوانش ممکن نشد.");
});
audio.addEventListener("timeupdate", () => {
  if (!audio.duration) return;
  const v = (audio.currentTime / audio.duration) * 1000;
  el.seek.value = v;
  el.seek.style.setProperty("--p", `${v / 10}%`);
  el.time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
});
el.seek.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (el.seek.value / 1000) * audio.duration;
  el.seek.style.setProperty("--p", `${el.seek.value / 10}%`);
});

/* ------------------------------------------------------------- shortcuts */

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
    e.preventDefault();
    requestPoem();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping() || el.drawer.open) return;
  if (e.key === "/") {
    e.preventDefault();
    el.input.focus();
    el.input.select();
  } else if (e.key.toLowerCase() === "r") {
    requestPoem();
  } else if (e.key === " " && state.poem?.recitations.length) {
    e.preventDefault();
    togglePlay();
  }
});

/* ------------------------------------------------------------------ boot */

async function boot() {
  const hash = /^#p(\d+)$/.exec(location.hash);
  if (state.history.length) el.input.value = state.history[0];

  // Load the poet list in the background; the poem doesn't have to wait for it.
  const poetsReady = listPoets()
    .then((poets) => {
      state.poets = poets;
      renderChips();
    })
    .catch((err) => {
      if (!hash) showNotice(err instanceof GanjoorError ? err.message : "");
    });

  if (hash) {
    await run((signal) => getPoemById(Number(hash[1]), signal));
  } else {
    await poetsReady;
    await run((signal) => pickRandomPoem(el.input.value.trim(), state.poets, signal), el.input.value.trim());
  }
}

boot().finally(() => { state.booted = true; });
