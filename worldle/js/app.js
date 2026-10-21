/* Worldle — web UI (GPL-3.0-or-later). Same shell as Ganjoorand. */
// @ts-nocheck

import {
  MAX_ATTEMPTS,
  addResult,
  chooseTarget,
  compassWord,
  emptyResults,
  evaluateGuess,
  formatKm,
  guidingCountry,
  loadDatabase,
  relativePosition,
  resolveCountry,
  suggestNames,
  summarize,
  summarizeCountry,
} from "./api.js";

const $ = (sel, root = document) => root.querySelector(sel);

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
      /* private mode, full storage */
    }
  },
};

const SIZES = [1.15, 1.3, 1.5, 1.7, 1.95, 2.3];

function loadResults() {
  const raw = store.get("wl.results", null);
  if (!raw || !Array.isArray(raw.results)) return emptyResults();
  const results = raw.results.filter((r) => r && typeof r.target === "string" && r.attempts >= 0);
  return { games_played: results.length, results };
}

export function boot() {
  const ac = new AbortController();
  const { signal } = ac;
  const on = (node, type, fn) => node && node.addEventListener(type, fn, { signal });

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
    hint: $("#hintLine"),
    guesses: $("#guesses"),
    plot: $("#plot"),
    metre: $("#metre"),
    again: $("#btnAgain"),
    giveUp: $("#btnGiveUp"),
    copy: $("#btnCopy"),
    priv: $("#btnPrivate"),
    drawer: $("#drawer"),
    drawerBody: $("#drawerBody"),
    tabStats: $("#tabStats"),
    tabHist: $("#tabHist"),
    clearBtn: $("#clearBtn"),
    toasts: $("#toasts"),
    themeIcon: $("#themeIcon"),
    library: $("#btnLibrary"),
  };

  if (!el.form || !el.card) return () => ac.abort();

  let db = null;
  let round = null;
  let results = loadResults();
  let tab = "stats";
  let suggestIdx = -1;
  let suggestList = [];
  let privateMode = !!store.get("wl.private", false);
  let sizeIdx = Math.min(Math.max(Number(store.get("wl.size", 2)) || 0, 0), SIZES.length - 1);
  let gen = 0;

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
  };

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

  function shake() {
    el.form.classList.remove("shake");
    // reflow so the animation restarts
    void el.form.offsetWidth;
    el.form.classList.add("shake");
  }

  /* -------------------------------------------------------------- theme */

  const media = matchMedia("(prefers-color-scheme: dark)");
  function effectiveDark() {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === "dark" : media.matches;
  }
  function syncThemeIcon() {
    el.themeIcon?.setAttribute("href", effectiveDark() ? "#i-sun" : "#i-moon");
  }
  on($("#btnTheme"), "click", () => {
    const next = effectiveDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("wl.theme", next);
    syncThemeIcon();
  });
  on(media, "change", syncThemeIcon);
  syncThemeIcon();

  function applySize() {
    document.documentElement.style.setProperty("--verse-size", `${SIZES[sizeIdx]}rem`);
    store.set("wl.size", sizeIdx);
  }
  on($("#btnBigger"), "click", () => {
    sizeIdx = Math.min(sizeIdx + 1, SIZES.length - 1);
    applySize();
  });
  on($("#btnSmaller"), "click", () => {
    sizeIdx = Math.max(sizeIdx - 1, 0);
    applySize();
  });
  applySize();

  /* --------------------------------------------------------------- chips */

  function renderChips() {
    const frag = document.createDocumentFragment();
    const used = round?.attempts || 0;
    const over = !!round?.over;
    const won = !!round?.success;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = String(i);
      chip.style.setProperty("--i", String(i - 1));
      if (won && i <= used) chip.classList.add("win");
      else if (i <= used) chip.classList.add("used");
      else if (!over && i === used + 1) chip.classList.add("now");
      frag.append(chip);
    }
    el.chips.replaceChildren(frag);
  }

  /* -------------------------------------------------------------- render */

  function closeness(distance) {
    return Math.max(0, Math.min(1, 1 - distance / 20015));
  }

  function renderGuesses() {
    const frag = document.createDocumentFragment();
    const last = (round?.guesses.length || 1) - 1;
    round?.guesses.forEach((g, i) => {
      const li = document.createElement("li");
      li.className = "guess";
      if (g.correct) li.classList.add("is-correct");
      if (g.isNeighbor) li.classList.add("is-neighbor");
      if (i !== last) li.classList.add("is-settled");
      li.style.setProperty("--i", String(i));

      const top = document.createElement("div");
      top.className = "guess-top";
      const n = document.createElement("span");
      n.className = "guess-n";
      n.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "guess-name";
      name.textContent = g.country;
      const dist = document.createElement("span");
      dist.className = "guess-dist";
      dist.textContent = g.correct ? "Correct" : g.isNeighbor ? "Border" : formatKm(g.distance);
      top.append(n, name, dist);

      const meta = document.createElement("div");
      meta.className = "guess-meta";
      if (!g.correct) {
        const arrow = document.createElement("span");
        arrow.className = "arrow";
        arrow.style.transform = `rotate(${g.bearing}deg)`;
        arrow.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
        arrow.title = `Head ${compassWord(g.compass)}`;
        const code = document.createElement("span");
        code.className = "compass-code";
        code.textContent = g.compass;
        const word = document.createElement("span");
        word.textContent = g.isNeighbor
          ? `borders it, head ${compassWord(g.compass)}`
          : compassWord(g.compass);
        const bar = document.createElement("span");
        bar.className = "bar";
        bar.title = g.isNeighbor ? "Shares a border" : formatKm(g.distance);
        const fill = document.createElement("i");
        const width = g.isNeighbor ? 92 : Math.round(closeness(g.distance) * 100);
        fill.style.setProperty("--w", `${width}%`);
        bar.append(fill);
        meta.append(arrow, code, word, bar);
      } else {
        const word = document.createElement("span");
        word.textContent = "That's the country.";
        meta.append(word);
      }

      li.append(top, meta);
      frag.append(li);
    });
    el.guesses.replaceChildren(frag);
  }

  function renderPlot() {
    if (!round?.over || !round.guesses.length) {
      el.plot.hidden = true;
      el.plot.replaceChildren();
      return;
    }
    const pts = round.guesses
      .filter((g) => !g.correct)
      .map((g, i) => ({ ...relativePosition(db, round.target, g.country), ...g, i }));
    // Include the winning guess at the origin so the trail ends on the star.
    const coords = pts.map((p) => [p.ew, p.ns]);
    coords.push([0, 0]);
    let max = 400;
    for (const [x, y] of coords) max = Math.max(max, Math.abs(x), Math.abs(y));
    const span = max * 1.18;
    const X = (ew) => (ew / span) * 78;
    const Y = (ns) => (-ns / span) * 78;

    const rings = [];
    const steps = [0.25, 0.5, 0.75, 1];
    for (const s of steps) {
      const r = (s * max * 78) / span;
      const km = Math.round((s * max) / 100) * 100;
      if (r > 8 && r < 90) rings.push({ r, km });
    }

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "-100 -108 200 216");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Guesses relative to ${round.target}. North is up.`);

    const frame = document.createElementNS(ns, "circle");
    frame.setAttribute("cx", "0");
    frame.setAttribute("cy", "0");
    frame.setAttribute("r", "90");
    frame.setAttribute("fill", "color-mix(in srgb, var(--gold) 8%, transparent)");
    frame.setAttribute("stroke", "var(--line)");
    svg.append(frame);

    for (const ring of rings) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", "0");
      c.setAttribute("cy", "0");
      c.setAttribute("r", String(ring.r));
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", "var(--line)");
      c.setAttribute("stroke-dasharray", "1.5 2");
      svg.append(c);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", String(ring.r + 1.2));
      label.setAttribute("y", "-1.2");
      label.setAttribute("fill", "var(--muted)");
      label.setAttribute("font-size", "4.2");
      label.textContent = `${ring.km.toLocaleString("en-US")} km`;
      svg.append(label);
    }

    const cross = (x1, y1, x2, y2) => {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "var(--line)");
      svg.append(line);
    };
    cross(-88, 0, 88, 0);
    cross(0, -88, 0, 88);

    for (const [txt, x, y] of [
      ["N", 0, -94],
      ["E", 94, 2],
      ["S", 0, 98],
      ["W", -94, 2],
    ]) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", String(x));
      t.setAttribute("y", String(y));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "var(--gold)");
      t.setAttribute("font-size", "6");
      t.setAttribute("font-weight", "700");
      t.textContent = txt;
      svg.append(t);
    }

    const trail = pts.map((p) => `${X(p.ew)},${Y(p.ns)}`);
    trail.push("0,0");
    if (trail.length > 1) {
      const poly = document.createElementNS(ns, "polyline");
      poly.setAttribute("points", trail.join(" "));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "var(--accent)");
      poly.setAttribute("stroke-width", "0.8");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.85");
      svg.append(poly);
    }

    pts.forEach((p) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(X(p.ew)));
      dot.setAttribute("cy", String(Y(p.ns)));
      dot.setAttribute("r", p.isNeighbor ? "2.4" : "2");
      dot.setAttribute("fill", "var(--accent)");
      dot.setAttribute("stroke", "var(--card)");
      dot.setAttribute("stroke-width", "0.6");
      const title = document.createElementNS(ns, "title");
      title.textContent = `${p.i + 1}. ${p.country}`;
      dot.append(title);
      svg.append(dot);
      const num = document.createElementNS(ns, "text");
      num.setAttribute("x", String(X(p.ew) + 2.6));
      num.setAttribute("y", String(Y(p.ns) - 2.4));
      num.setAttribute("fill", "var(--ink)");
      num.setAttribute("font-size", "4.6");
      num.textContent = `${p.i + 1}. ${p.country}`;
      svg.append(num);
    });

    const star = document.createElementNS(ns, "path");
    star.setAttribute("d", "M0-5.2 1.15-1.4 5.1-1.2 2.05 1.15 2.9 5 0 3.05-2.9 5-2.05 1.15-5.1-1.2-1.15-1.4Z");
    star.setAttribute("fill", "var(--gold)");
    star.setAttribute("stroke", "var(--ink)");
    star.setAttribute("stroke-width", "0.35");
    const starTitle = document.createElementNS(ns, "title");
    starTitle.textContent = round.target;
    star.append(starTitle);
    svg.append(star);

    const caption = document.createElement("p");
    caption.className = "plot-caption";
    caption.textContent = `Guesses relative to ${round.target}. North is up. The star is the answer.`;

    el.plot.hidden = false;
    el.plot.replaceChildren(svg, caption);
  }

  function render() {
    const playing = !!round && !round.over;
    el.card.classList.remove("is-empty", "is-loading", "is-win", "is-lose");
    if (!round) el.card.classList.add("is-empty");
    if (round?.success) el.card.classList.add("is-win");
    else if (round?.over) el.card.classList.add("is-lose");
    el.content.hidden = !round;
    el.go.disabled = !playing;
    el.input.disabled = !playing;
    el.giveUp.disabled = !playing;
    el.again.disabled = !db;
    el.priv.setAttribute("aria-pressed", String(privateMode));

    if (!round) {
      renderChips();
      return;
    }

    const left = MAX_ATTEMPTS - round.attempts;
    if (round.success) {
      el.kicker.textContent = "Solved";
      el.title.textContent = round.target;
      el.hint.textContent = `You found it in ${round.attempts} guess${round.attempts === 1 ? "" : "es"}.`;
      document.title = `${round.target} — Worldle`;
    } else if (round.over) {
      el.kicker.textContent = round.reason === "giveup" ? "Revealed" : "Out of guesses";
      el.title.textContent = round.target;
      el.hint.textContent =
        round.reason === "giveup"
          ? `You gave up. The country was ${round.target}.`
          : `No guesses left. The country was ${round.target}.`;
      document.title = `${round.target} — Worldle`;
    } else if (round.guesses.length) {
      const last = round.guesses[round.guesses.length - 1];
      el.kicker.textContent = `Guess ${round.attempts} of ${MAX_ATTEMPTS}`;
      if (last.isNeighbor) {
        el.title.textContent = `Border — head ${compassWord(last.compass)}`;
      } else {
        el.title.textContent = `${formatKm(last.distance)} ${compassWord(last.compass)}`;
      }
      el.hint.innerHTML = "";
      el.hint.append("Hint still stands: from ");
      const strong = document.createElement("strong");
      strong.textContent = round.guiding.name;
      el.hint.append(strong, `, head ${formatKm(round.guiding.distance)} ${compassWord(round.guiding.compass)}.`);
      document.title = "Worldle";
    } else {
      el.kicker.textContent = `Guess 1 of ${MAX_ATTEMPTS}`;
      el.title.textContent = "Where in the world?";
      el.hint.innerHTML = "";
      el.hint.append("From ");
      const strong = document.createElement("strong");
      strong.textContent = round.guiding.name;
      el.hint.append(
        strong,
        `, the country is ${formatKm(round.guiding.distance)} ${compassWord(round.guiding.compass)}.`,
      );
      document.title = "Worldle";
    }

    if (round.over) {
      el.metre.hidden = false;
      const saved = privateMode ? "Private round, not saved." : "Saved to your history on this device.";
      el.metre.textContent = round.success
        ? `${round.attempts} / ${MAX_ATTEMPTS} · ${saved}`
        : round.reason === "giveup"
          ? `Given up · ${saved}`
          : `No guesses left · ${saved}`;
    } else {
      el.metre.hidden = false;
      const tail = privateMode ? " · private, not saved" : "";
      el.metre.textContent =
        left === 1 ? `Last guess${tail}` : `${left} guesses left${tail}`;
    }

    renderGuesses();
    renderPlot();
    renderChips();
  }

  /* --------------------------------------------------------------- round */

  function startRound({ focus = false } = {}) {
    const target = chooseTarget(db);
    round = {
      target,
      guiding: guidingCountry(db, target),
      guesses: [],
      tried: new Set(),
      attempts: 0,
      over: false,
      success: false,
      reason: "",
      saved: false,
    };
    showNotice("");
    suggestList = [];
    hideSuggest();
    el.input.value = "";
    render();
    if (focus) el.input.focus();
  }

  function saveRound() {
    if (!round || round.saved || privateMode) return;
    if (round.attempts <= 0 && !round.over) return;
    results = addResult(results, round.attempts, round.target, round.success);
    store.set("wl.results", results);
    round.saved = true;
    if (el.drawer?.open) renderDrawer();
  }

  function finish(success, reason) {
    if (!round || round.over) return;
    round.over = true;
    round.success = success;
    round.reason = reason;
    saveRound();
    render();
  }

  function abandonForNewGame() {
    if (round && !round.over && round.attempts > 0) {
      round.over = true;
      round.success = false;
      round.reason = "giveup";
      saveRound();
    }
    startRound({ focus: true });
  }

  function submitGuess(raw) {
    if (!round || round.over) return;
    const text = String(raw ?? "").trim();
    if (!text) {
      showNotice("Type a country name.");
      shake();
      return;
    }

    if (/^[1-6]$/.test(text) && suggestList.length) {
      const pick = suggestList[Number(text) - 1];
      if (pick) {
        el.input.value = pick;
        hideSuggest();
        submitGuess(pick);
        return;
      }
    }

    const exact = resolveCountry(text, db);
    if (!exact) {
      suggestList = suggestNames(text, db);
      if (suggestList.length === 1) {
        el.input.value = suggestList[0];
        hideSuggest();
        submitGuess(suggestList[0]);
        return;
      }
      showSuggest(suggestList, text);
      showNotice(
        suggestList.length
          ? "No exact match. Pick a country below — this does not use a guess."
          : "Unknown country. Try another spelling.",
      );
      shake();
      return;
    }

    const norm = exact.toLowerCase();
    if (round.tried.has(norm)) {
      showNotice(`You already tried ${exact}.`);
      shake();
      hideSuggest();
      return;
    }

    const outcome = evaluateGuess(db, round.target, exact);
    round.tried.add(norm);
    round.attempts += 1;
    round.guesses.push(outcome);
    el.input.value = "";
    hideSuggest();
    showNotice("");

    if (outcome.correct) finish(true, "win");
    else if (round.attempts >= MAX_ATTEMPTS) finish(false, "lose");
    else {
      render();
      el.input.focus();
    }
  }

  /* ---------------------------------------------------------- suggestions */

  function hideSuggest() {
    el.suggest.hidden = true;
    el.suggest.replaceChildren();
    suggestIdx = -1;
  }

  function showSuggest(list, typed) {
    suggestList = list;
    suggestIdx = -1;
    if (!list.length) return hideSuggest();
    const frag = document.createDocumentFragment();
    list.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = '<svg class="i"><use href="#i-compass"/></svg><span></span>';
      $("span", b).textContent = `${i + 1}.  ${name}`;
      b.dataset.name = name;
      frag.append(b);
    });
    el.suggest.replaceChildren(frag);
    el.suggest.hidden = false;
    if (typed) el.input.value = typed;
  }

  on(el.input, "input", () => {
    showNotice("");
    const q = el.input.value.trim();
    if (!q || !db || !round || round.over) return hideSuggest();
    if (/^[1-6]$/.test(q) && suggestList.length) return;
    const list = suggestNames(q, db);
    if (!list.length || (list.length === 1 && list[0].toLowerCase() === q.toLowerCase())) {
      suggestList = list;
      return hideSuggest();
    }
    showSuggest(list);
  });

  on(el.input, "keydown", (e) => {
    const buttons = [...el.suggest.querySelectorAll("button")];
    if (e.key === "Escape") return hideSuggest();
    if (el.suggest.hidden || !buttons.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      suggestIdx = (suggestIdx + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((b, i) => b.setAttribute("aria-selected", String(i === suggestIdx)));
      buttons[suggestIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && suggestIdx >= 0) {
      e.preventDefault();
      const name = buttons[suggestIdx].dataset.name;
      hideSuggest();
      submitGuess(name);
    }
  });

  on(el.suggest, "mousedown", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    e.preventDefault();
    hideSuggest();
    submitGuess(b.dataset.name);
  });

  on(el.form, "submit", (e) => {
    e.preventDefault();
    if (suggestIdx >= 0 && !el.suggest.hidden) {
      const b = el.suggest.querySelectorAll("button")[suggestIdx];
      if (b) {
        hideSuggest();
        submitGuess(b.dataset.name);
        return;
      }
    }
    submitGuess(el.input.value);
  });

  on(el.input, "blur", () => setTimeout(() => {
    if (!signal.aborted) hideSuggest();
  }, 140));

  /* ----------------------------------------------------------------- dock */

  on(el.again, "click", () => {
    if (!db) return;
    abandonForNewGame();
    toast("New country.");
  });

  on(el.giveUp, "click", () => {
    if (!round || round.over) return;
    finish(false, "giveup");
    toast(`The country was ${round.target}.`);
  });

  function shareText() {
    if (!round) return "";
    const head = round.success
      ? `Worldle ${round.attempts}/${MAX_ATTEMPTS}`
      : round.over
        ? `Worldle X/${MAX_ATTEMPTS}`
        : `Worldle ${round.attempts}/${MAX_ATTEMPTS}`;
    const lines = round.guesses.map((g) => {
      if (g.correct) return `✓   ${g.country}`;
      if (g.isNeighbor) return `◆   border ${g.compass}   ${g.country}`;
      return `${g.compass.padEnd(2, " ")}  ${formatKm(g.distance).padStart(10, " ")}   ${g.country}`;
    });
    return [head, ...lines].join("\n");
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
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  on(el.copy, "click", async () => {
    if (!round || !round.guesses.length) return toast("Make a guess first.");
    toast((await copyToClipboard(shareText())) ? "Result copied." : "Could not copy.");
  });

  on(el.priv, "click", () => {
    privateMode = !privateMode;
    store.set("wl.private", privateMode);
    el.priv.setAttribute("aria-pressed", String(privateMode));
    if (round && !round.over) render();
    toast(privateMode ? "Private — this round won't be saved." : "Rounds will be saved on this device.");
  });

  /* --------------------------------------------------------------- drawer */

  function statBox(value, label, wide = false) {
    const div = document.createElement("div");
    div.className = wide ? "stat wide" : "stat";
    const b = document.createElement("b");
    b.textContent = value;
    const s = document.createElement("span");
    s.textContent = label;
    div.append(b, s);
    return div;
  }

  function renderCountryStats(host, query) {
    host.replaceChildren();
    const q = query.trim();
    if (!q) return;
    const exact = resolveCountry(q, db);
    if (!exact) {
      const suggestions = suggestNames(q, db, 4);
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = suggestions.length ? "Did you mean:" : "No country by that name.";
      host.append(p);
      for (const name of suggestions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.style.margin = ".25rem .35rem 0 0";
        b.textContent = name;
        b.addEventListener("click", () => {
          const input = $("#countryQ", el.drawerBody);
          if (input) input.value = name;
          renderCountryStats(host, name);
        });
        host.append(b);
      }
      return;
    }
    const stats = summarizeCountry(results, exact);
    const title = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = exact;
    title.append(strong);
    host.append(title);
    if (!stats.played) {
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = "No finished rounds with this country as the answer.";
      host.append(p);
      return;
    }
    const line = document.createElement("p");
    line.textContent = `${stats.played} game${stats.played === 1 ? "" : "s"} · ${stats.won} won · ${stats.lost} lost`;
    host.append(line);
    const rate = document.createElement("p");
    rate.textContent = `Success rate ${stats.rate.toFixed(0)}%`;
    host.append(rate);
    if (stats.avg != null) {
      const avg = document.createElement("p");
      avg.className = "sub";
      avg.textContent = `Average winning guesses: ${stats.avg.toFixed(2)}`;
      host.append(avg);
    }
  }

  function renderStats(root) {
    const stats = summarize(results);
    const grid = document.createElement("div");
    grid.className = "stat-grid";
    grid.append(
      statBox(String(stats.played), "Games played"),
      statBox(`${stats.rate.toFixed(0)}%`, "Success rate"),
      statBox(String(stats.won), "Won"),
      statBox(String(stats.lost), "Lost"),
    );
    if (stats.avg != null) {
      grid.append(statBox(stats.avg.toFixed(2), "Average guesses when you win", true));
    }
    if (stats.best) {
      grid.append(
        statBox(
          `${stats.best.attempts}`,
          `Best round · ${stats.best.target}`,
          true,
        ),
      );
    }
    root.append(grid);

    const dist = document.createElement("div");
    dist.className = "dist";
    const h = document.createElement("h3");
    h.textContent = "Wins by guess";
    dist.append(h);
    const peak = Math.max(1, ...stats.dist);
    stats.dist.forEach((count, i) => {
      const row = document.createElement("div");
      row.className = "dist-row";
      const n = document.createElement("span");
      n.textContent = String(i + 1);
      const bar = document.createElement("i");
      const fill = document.createElement("span");
      fill.style.setProperty("--w", `${(count / peak) * 100}%`);
      bar.append(fill);
      const c = document.createElement("span");
      c.textContent = String(count);
      row.append(n, bar, c);
      dist.append(row);
    });
    root.append(dist);

    const label = document.createElement("label");
    label.className = "drawer-search";
    const input = document.createElement("input");
    input.id = "countryQ";
    input.type = "text";
    input.placeholder = "Stats for one country";
    input.autocomplete = "off";
    input.spellcheck = false;
    label.append(input);
    const countryHost = document.createElement("div");
    countryHost.className = "country-stats";
    countryHost.hidden = true;
    input.addEventListener("input", () => {
      const q = input.value.trim();
      countryHost.hidden = !q;
      renderCountryStats(countryHost, input.value);
    });
    root.append(label, countryHost);

    const note = document.createElement("p");
    note.className = "rules-note";
    note.textContent =
      "Ten guesses. Each one shows distance and compass direction. A bordering country costs a guess and only tells you the way to turn.";
    root.append(note);
  }

  function renderHistory(root) {
    const list = document.createElement("ul");
    list.className = "drawer-list";
    const items = [...results.results].reverse();
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty-li";
      li.textContent = "No games yet. Finish a round and it will land here.";
      list.append(li);
    }
    for (const item of items) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = item.target;
      const sub = document.createElement("span");
      sub.className = "sub";
      const when = item.when
        ? new Date(item.when).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      sub.textContent = item.success
        ? `Won in ${item.attempts} ${when ? "· " + when : ""}`
        : `Lost ${when ? "· " + when : ""}`.trim();
      b.append(sub);
      li.append(b);
      list.append(li);
    }
    root.append(list);
  }

  function renderDrawer() {
    el.tabStats.setAttribute("aria-selected", String(tab === "stats"));
    el.tabHist.setAttribute("aria-selected", String(tab === "hist"));
    el.drawerBody.replaceChildren();
    if (!db) {
      const p = document.createElement("p");
      p.className = "empty-li";
      p.textContent = "Still loading countries…";
      el.drawerBody.append(p);
      return;
    }
    if (tab === "stats") renderStats(el.drawerBody);
    else renderHistory(el.drawerBody);
    el.clearBtn.hidden = results.results.length === 0;
  }

  function openDrawer(next) {
    tab = next || tab;
    renderDrawer();
    if (!el.drawer.open) el.drawer.showModal();
  }

  on(el.library, "click", () => openDrawer("stats"));
  on(el.tabStats, "click", () => {
    tab = "stats";
    renderDrawer();
  });
  on(el.tabHist, "click", () => {
    tab = "hist";
    renderDrawer();
  });
  on($("#drawerClose"), "click", () => el.drawer.close());
  on(el.drawer, "click", (e) => {
    if (e.target === el.drawer) el.drawer.close();
  });
  on(el.clearBtn, "click", () => {
    results = emptyResults();
    store.set("wl.results", results);
    renderDrawer();
    toast("History cleared.");
  });

  /* ------------------------------------------------------------ keyboard */

  on(document, "keydown", (e) => {
    if (e.key === "/" && !isTyping()) {
      e.preventDefault();
      el.input.focus();
      el.input.select();
    } else if (
      (e.key === "r" || e.key === "R") &&
      !isTyping() &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      db
    ) {
      e.preventDefault();
      abandonForNewGame();
    }
  });

  /* ----------------------------------------------------------------- boot */

  el.card.classList.add("is-loading");
  el.card.setAttribute("aria-busy", "true");
  renderChips();

  const my = ++gen;
  loadDatabase()
    .then((loaded) => {
      if (signal.aborted || my !== gen) return;
      db = loaded;
      el.card.setAttribute("aria-busy", "false");
      startRound();
    })
    .catch(() => {
      if (signal.aborted) return;
      el.card.classList.remove("is-loading");
      el.card.classList.add("is-empty");
      el.card.setAttribute("aria-busy", "false");
      showNotice("Could not load the country list.");
    });

  if (document.documentElement.dataset.worldleStatic === "1" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  return () => {
    gen += 1;
    ac.abort();
    if (el.drawer?.open) el.drawer.close();
  };
}

if (typeof document !== "undefined" && document.documentElement.dataset.worldleStatic === "1") {
  const start = () => boot();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
