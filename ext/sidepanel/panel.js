(() => {
  // src/lib/knowledge-search.ts
  function refKey(ref) {
    return ref.kind === "transcript" ? JSON.stringify(["transcript", ref.recordId, ref.lineId]) : JSON.stringify(["note", ref.noteId, ref.entryId]);
  }

  // src/ext/content/favorite-control.ts
  var libraryRequest = (type, fields = {}) => chrome.runtime.sendMessage({ target: "background", type, ...fields });
  function requireSuccess(result) {
    if (!result?.ok) {
      const messages = { CURSOR_EXPIRED: "\u8FD9\u6B21\u641C\u7D22\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u7ED3\u679C", CURSOR_MISMATCH: "\u641C\u7D22\u6761\u4EF6\u5DF2\u66F4\u6539\uFF0C\u8BF7\u5237\u65B0\u7ED3\u679C", CONFIRMATION_STALE: "\u8D44\u6599\u6216\u6536\u85CF\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u5220\u9664\u8303\u56F4" };
      throw Object.assign(new Error(messages[result?.code || ""] || result?.error || "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5"), { code: result?.code });
    }
  }
  function createFavoriteState(request2 = libraryRequest) {
    let refs = /* @__PURE__ */ new Set();
    let status = "loading";
    let error = "";
    let serial = 0;
    const busy = /* @__PURE__ */ new Set();
    const listeners = /* @__PURE__ */ new Set();
    const emit = () => listeners.forEach((fn) => fn());
    async function refresh() {
      const sequence = ++serial;
      try {
        const result = await request2("LIBRARY_FAVORITES");
        requireSuccess(result);
        if (sequence !== serial) return;
        refs = new Set(result.refs.map(refKey));
        status = "ready";
        error = "";
      } catch (cause) {
        if (sequence !== serial) return;
        status = "error";
        error = String(cause);
      }
      emit();
    }
    async function toggle(ref) {
      const key = refKey(ref);
      if (status !== "ready") throw new Error("\u6536\u85CF\u72B6\u6001\u5C1A\u672A\u8BFB\u53D6\uFF0C\u8BF7\u91CD\u8BD5");
      if (busy.has(key)) return refs.has(key);
      busy.add(key);
      emit();
      try {
        const result = await request2("LIBRARY_FAVORITE", { ref, favorite: !refs.has(key) });
        requireSuccess(result);
        const favorite = result.favorite === true;
        if (favorite) refs.add(key);
        else refs.delete(key);
        await refresh();
        return favorite;
      } finally {
        busy.delete(key);
        emit();
      }
    }
    return { refresh, toggle, get status() {
      return status;
    }, get error() {
      return error;
    }, has: (ref) => refs.has(refKey(ref)), busy: (ref) => busy.has(refKey(ref)), subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    } };
  }
  var shared;
  function favoriteState() {
    if (!shared) {
      shared = createFavoriteState();
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["snooper.library.favorites.v1"]) void shared?.refresh();
      });
      void shared.refresh();
    }
    return shared;
  }
  var favoriteDisposers = /* @__PURE__ */ new WeakMap();
  function disposeFavoriteControls(container) {
    favoriteDisposers.get(container)?.();
    favoriteDisposers.delete(container);
    for (const child of Array.from(container.children)) disposeFavoriteControls(child);
  }
  function createFavoriteButton(ref, notify, state = favoriteState()) {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.className = "library-favorite btn btn-sm btn-secondary";
    button2.dataset.action = "favorite";
    const update = () => {
      button2.disabled = !ref || state.busy(ref) || state.status === "loading";
      button2.textContent = !ref ? "\u4FDD\u5B58\u540E\u53EF\u6536\u85CF" : state.status === "loading" ? "\u8BFB\u53D6\u6536\u85CF\u2026" : state.status === "error" ? "\u91CD\u8BD5\u8BFB\u53D6\u6536\u85CF" : state.has(ref) ? "\u2605 \u5DF2\u6536\u85CF" : "\u2606 \u6536\u85CF";
      button2.setAttribute("aria-pressed", String(!!ref && state.has(ref)));
      button2.title = !ref ? "\u6B63\u6587\u6210\u529F\u4FDD\u5B58\u540E\u624D\u80FD\u6536\u85CF" : state.status === "error" ? state.error : "\u6536\u85CF\u6B64\u6761\u539F\u6587\u4E0E\u8BD1\u6587";
    };
    update();
    favoriteDisposers.set(button2, state.subscribe(update));
    button2.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!ref) return;
      if (state.status === "error") {
        await state.refresh();
        return;
      }
      try {
        await state.toggle(ref);
      } catch (error) {
        notify(`\u6536\u85CF\u672A\u66F4\u6539\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return button2;
  }

  // src/ext/sidepanel/library.ts
  function createLibrarySearch(deps) {
    const request2 = deps.request || libraryRequest;
    const schedule = deps.schedule || setTimeout;
    const unschedule = deps.unschedule || clearTimeout;
    const state = { query: "", favoritesOnly: false, status: "idle", sequence: 0, hits: /* @__PURE__ */ new Map(), cursor: null, scanned: 0, errors: [], changed: false, scopes: [], error: "" };
    let timer;
    const emit = (added = [], reset = false) => deps.changed(state, added, reset);
    const cancelCursor = (cursor) => {
      if (cursor) void request2("LIBRARY_CANCEL_SEARCH", { cursor }).catch(() => {
      });
    };
    function invalidate() {
      state.sequence++;
      if (timer !== void 0) {
        unschedule(timer);
        timer = void 0;
      }
      cancelCursor(state.cursor);
      state.cursor = null;
      return state.sequence;
    }
    async function scan(sequence) {
      state.status = "searching";
      state.error = "";
      state.errors = [];
      emit();
      do {
        try {
          const response = await request2("LIBRARY_SEARCH", { query: state.query, favoritesOnly: state.favoritesOnly, ...state.cursor ? { cursor: state.cursor } : {} });
          if (sequence !== state.sequence) {
            cancelCursor(typeof response?.cursor === "string" ? response.cursor : null);
            return;
          }
          requireSuccess(response);
          const result = response;
          const added = [];
          for (const hit of result.hits) {
            const key = refKey(hit.ref);
            if (!state.hits.has(key)) {
              state.hits.set(key, hit);
              added.push(hit);
            }
          }
          state.cursor = result.cursor;
          state.scanned = result.scanned;
          state.errors = result.errors;
          state.changed ||= result.changed;
          state.scopes = result.scopes;
          state.status = result.errors.length ? "partial" : result.complete ? !result.scopes.length ? "empty" : !state.query.trim() ? "idle" : !state.hits.size ? "no-match" : "complete" : "searching";
          emit(added);
          if (result.errors.length || result.complete || !result.cursor) return;
        } catch (error) {
          if (sequence !== state.sequence) return;
          state.status = "failed";
          state.error = error instanceof Error ? error.message : String(error);
          if (error && typeof error === "object" && "code" in error && ["CURSOR_EXPIRED", "CURSOR_MISMATCH"].includes(String(error.code))) state.cursor = null;
          emit();
          return;
        }
      } while (sequence === state.sequence);
    }
    async function start(query, favoritesOnly) {
      const sequence = invalidate();
      Object.assign(state, { query: query.trim(), favoritesOnly, status: "searching", hits: /* @__PURE__ */ new Map(), scanned: 0, errors: [], changed: false, scopes: [], error: "" });
      emit([], true);
      await scan(sequence);
    }
    function input(query, favoritesOnly) {
      const sequence = invalidate();
      Object.assign(state, { query: query.trim(), favoritesOnly, status: "searching", hits: /* @__PURE__ */ new Map(), scanned: 0, errors: [], changed: false, scopes: [], error: "" });
      emit([], true);
      timer = schedule(() => {
        if (sequence === state.sequence) return start(query, favoritesOnly);
      }, 180);
    }
    async function retry() {
      if (state.status === "searching") return;
      if (!state.cursor) return start(state.query, state.favoritesOnly);
      await scan(state.sequence);
    }
    function cancel() {
      invalidate();
      state.status = "cancelled";
      emit();
    }
    return { state, start, input, retry, cancel };
  }

  // src/lib/video-clock.ts
  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = total % 60;
    const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
  }

  // src/ext/sidepanel/library-render.ts
  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function button(text, action, run) {
    const node = element("button", "btn btn-sm btn-secondary", text);
    node.type = "button";
    node.dataset.action = action;
    node.addEventListener("click", run);
    return node;
  }
  function appendHighlight(container, text, ranges = []) {
    let offset = 0;
    for (const [start, end] of ranges) {
      if (start < offset || end > text.length || end <= start) continue;
      container.append(document.createTextNode(text.slice(offset, start)), element("mark", "", text.slice(start, end)));
      offset = end;
    }
    container.append(document.createTextNode(text.slice(offset)));
  }
  async function openEntrySource(ref) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await libraryRequest("LIBRARY_OPEN_SOURCE", { ref, ...tab?.id !== void 0 ? { tabId: tab.id } : {} });
    requireSuccess(response);
    return response.action === "seeked" ? "\u5DF2\u5B9A\u4F4D\u5230\u539F\u89C6\u9891\u5BF9\u5E94\u4F4D\u7F6E" : String(response.degraded || "\u5DF2\u6253\u5F00\u6765\u6E90\u9875\u9762\uFF1B\u64AD\u653E\u4F4D\u7F6E\u7531\u6765\u6E90\u9875\u9762\u5904\u7406");
  }
  function renderEntry(entry, notify, options = {}) {
    const row = element("article", `library-entry${options.context ? " library-neighbor" : ""}`);
    row.dataset.ref = refKey(entry.ref);
    const type = entry.ref.kind === "transcript" ? entry.type === "screen" ? "\u753B\u9762\u5B57\u5E55" : "\u5B57\u5E55" : { text: "\u7B14\u8BB0", subtitle: "\u5B57\u5E55\u7B14\u8BB0", summary: "\u5B66\u4E60\u7EAA\u8981", image: "\u914D\u56FE", screenshot: "\u622A\u56FE", svg: "\u77E2\u91CF\u56FE" }[entry.type] || "\u7B14\u8BB0";
    const clock = entry.videoTime !== null ? `\u89C6\u9891 ${formatVideoTime(entry.videoTime)}` : "\u672A\u4FDD\u5B58\u64AD\u653E\u65F6\u95F4";
    const at = entry.at ? new Date(entry.at).toLocaleString("zh-CN") : "\u65F6\u95F4\u672A\u77E5";
    row.append(element("p", "library-entry-meta", `${options.context ? "\u4E0A\u4E0B\u6587 \xB7 " : ""}${type} \xB7 ${clock} \xB7 ${at}`));
    for (const field of ["source", "target", "text"]) {
      if (!entry[field]) continue;
      const content = element("p", `library-${field}`);
      content.append(element("span", "library-field-label", { source: "\u539F\u6587", target: "\u8BD1\u6587", text: "\u7B14\u8BB0" }[field]));
      appendHighlight(content, entry[field], options.highlights?.[field]);
      row.append(content);
    }
    if (!entry.source && !entry.target && !entry.text) row.append(element("p", "", "\u6B64\u6761\u76EE\u4EC5\u542B\u56FE\u7247\u6216\u9644\u4EF6\uFF0C\u6587\u5B57\u6B63\u6587\u4E3A\u7A7A\u3002\u53EF\u4ECE\u7B14\u8BB0\u5386\u53F2\u5BFC\u51FA\u9644\u4EF6\u3002"));
    const actions = element("div", "library-actions");
    actions.append(createFavoriteButton(entry.ref, notify));
    const source = button("\u67E5\u770B\u6765\u6E90", "source", () => {
      source.disabled = true;
      void openEntrySource(entry.ref).then(notify).catch((error) => notify(String(error))).finally(() => {
        source.disabled = false;
      });
    });
    source.disabled = !entry.sourceRef.url;
    source.title = entry.sourceRef.confidence === "exact" ? "\u6838\u9A8C\u6765\u6E90\u540E\u8DF3\u8F6C\uFF1B\u4E0D\u80FD\u5B9A\u4F4D\u65F6\u6253\u5F00\u6765\u6E90" : "\u6765\u6E90\u8BFE\u8282\u672A\u6838\u9A8C\uFF0C\u4EC5\u6253\u5F00\u6765\u6E90\u9875\u9762";
    actions.append(source);
    if (options.neighbors !== false) {
      const contextArea = element("div", "library-context");
      contextArea.hidden = true;
      let contextLoaded = false;
      const context = button("\u67E5\u770B\u4E0A\u4E0B\u6587", "context", async () => {
        if (!contextArea.hidden && contextLoaded) {
          disposeFavoriteControls(contextArea);
          contextArea.textContent = "";
          contextArea.hidden = true;
          contextLoaded = false;
          context.textContent = "\u67E5\u770B\u4E0A\u4E0B\u6587";
          return;
        }
        disposeFavoriteControls(contextArea);
        context.disabled = true;
        contextArea.hidden = false;
        contextArea.textContent = "\u6B63\u5728\u8BFB\u53D6\u4E0A\u4E0B\u6587\u2026";
        try {
          const response = await libraryRequest("LIBRARY_CONTEXT", { ref: entry.ref });
          if (!contextArea.isConnected) return;
          requireSuccess(response);
          contextArea.textContent = "";
          contextArea.append(element("p", "section-desc", "\u524D\u540E\u76F8\u90BB\u6587\u5B57\u4EC5\u7528\u4E8E\u7406\u89E3\u4E0A\u4E0B\u6587\uFF0C\u6536\u85CF\u6309\u94AE\u5206\u522B\u5BF9\u5E94\u5404\u81EA\u6761\u76EE\u3002"));
          for (const neighbor of response.before) contextArea.append(renderEntry(neighbor, notify, { context: true, neighbors: false }));
          contextArea.append(renderEntry(response.entry, notify, { neighbors: false }));
          for (const neighbor of response.after) contextArea.append(renderEntry(neighbor, notify, { context: true, neighbors: false }));
          contextLoaded = true;
          context.textContent = "\u6536\u8D77\u4E0A\u4E0B\u6587";
        } catch (error) {
          if (!contextArea.isConnected) return;
          contextLoaded = false;
          contextArea.textContent = `\u4E0A\u4E0B\u6587\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}`;
          context.textContent = "\u91CD\u8BD5\u4E0A\u4E0B\u6587";
        } finally {
          context.disabled = false;
        }
      });
      actions.append(context);
      row.append(actions, contextArea);
    } else row.append(actions);
    return row;
  }
  function groupKey(hit) {
    return hit.sourceRef.confidence === "exact" ? hit.sourceRef.key : hit.ref.kind === "transcript" ? `record:${hit.ref.recordId}` : `note:${hit.ref.noteId}`;
  }
  function createResultRenderer(container, notify) {
    const groups = /* @__PURE__ */ new Map();
    const favorites = favoriteState();
    function paint(group) {
      const end = Math.min(group.hits.length, group.limit);
      for (; group.shown < end; group.shown++) {
        const hit = group.hits[group.shown];
        group.list.append(renderEntry(hit, notify, { highlights: hit.highlights }));
      }
      group.count.textContent = `${group.hits.length} \u6761\u5339\u914D`;
      group.more.hidden = group.shown >= group.hits.length;
      group.more.textContent = group.limit === 3 ? `\u5C55\u5F00\u5168\u90E8\uFF08${group.hits.length} \u6761\uFF09` : `\u663E\u793A\u66F4\u591A\uFF08\u5269\u4F59 ${group.hits.length - group.shown} \u6761\uFF09`;
    }
    function update(state, added, reset) {
      if (reset) {
        disposeFavoriteControls(container);
        groups.clear();
        container.textContent = "";
      }
      const touched = /* @__PURE__ */ new Set();
      for (const hit of added) {
        const key = groupKey(hit);
        let group = groups.get(key);
        if (!group) {
          const section = element("section", "library-group");
          section.dataset.group = key;
          const head = element("div", "library-group-heading");
          const heading = element("h3", "", hit.sourceRef.title || hit.title || "\u672A\u547D\u540D\u8D44\u6599");
          const count = element("span", "section-badge");
          head.append(heading, count);
          const list = element("div", "library-group-entries");
          const more = button("", "more", () => {
            group.limit = group.limit === 3 ? 53 : group.limit + 50;
            paint(group);
          });
          group = { source: hit.sourceRef, hits: [], list, count, more, shown: 0, limit: 3 };
          section.append(head, element("p", "library-provenance", hit.sourceRef.confidence === "exact" ? "\u5DF2\u6838\u9A8C\u8BFE\u8282\u6765\u6E90" : hit.ref.kind === "transcript" ? "\u6765\u6E90\u672A\u6838\u9A8C \xB7 \u6309\u539F\u8F6C\u5199\u8BB0\u5F55\u533A\u5206" : "\u6765\u6E90\u672A\u6838\u9A8C \xB7 \u6309\u539F\u7B14\u8BB0\u533A\u5206"), list, more);
          container.append(section);
          groups.set(key, group);
        }
        group.hits.push(hit);
        touched.add(group);
      }
      for (const group of touched) paint(group);
      container.setAttribute("aria-busy", String(state.status === "searching"));
      container.dataset.total = String(state.hits.size);
    }
    return { update, refreshFavorites: () => favorites.refresh() };
  }

  // src/ext/sidepanel/library-panel.ts
  function mountLibraryPanel(showTab) {
    const root = document.getElementById("panel-search");
    const query = document.getElementById("library-query");
    const filter = document.getElementById("library-favorites-only");
    const status = document.getElementById("library-status");
    const warning = document.getElementById("library-warning");
    const message = document.getElementById("library-message");
    const retry = document.getElementById("library-retry");
    const restart = document.getElementById("library-restart");
    const cancel = document.getElementById("library-cancel");
    const usage = document.getElementById("library-usage");
    const notify = (text) => {
      message.textContent = text;
    };
    const results = createResultRenderer(document.getElementById("library-results"), notify);
    function changed(state, added, reset) {
      results.update(state, added, reset);
      const count = state.hits.size;
      status.textContent = {
        idle: `\u5DF2\u4FDD\u5B58 ${state.scopes.length} \u4EFD\u8D44\u6599\u3002\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22\u539F\u6587\u3001\u8BD1\u6587\u548C\u7B14\u8BB0\u3002`,
        searching: `\u641C\u7D22\u4E2D\u2026 \u5DF2\u8BFB\u53D6 ${state.scanned} \u6761\uFF0C\u627E\u5230 ${count} \u6761`,
        complete: `\u641C\u7D22\u5B8C\u6210 \xB7 ${count} \u6761\u5339\u914D \xB7 \u5DF2\u8BFB\u53D6 ${state.scanned} \u6761`,
        "no-match": `\u641C\u7D22\u5B8C\u6210\uFF0C\u672A\u627E\u5230\u5339\u914D \xB7 \u5DF2\u8BFB\u53D6 ${state.scanned} \u6761`,
        empty: "\u8FD8\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u8D44\u6599\u3002\u4FDD\u5B58\u5B57\u5E55\u6216\u7B14\u8BB0\u540E\u53EF\u5728\u8FD9\u91CC\u68C0\u7D22\u3002",
        partial: `\u5C1A\u672A\u5B8C\u6574\u8BFB\u53D6 \xB7 \u5DF2\u627E\u5230 ${count} \u6761\u3002\u8BF7\u91CD\u8BD5\u8BFB\u53D6\u5931\u8D25\u7684\u8D44\u6599\u3002`,
        failed: `\u8BF7\u6C42\u5931\u8D25\uFF0C\u68C0\u7D22\u672A\u5B8C\u6210\uFF1A${state.error}\u3002\u8BF7\u91CD\u8BD5\u6216\u91CD\u65B0\u641C\u7D22\u3002`,
        cancelled: `\u5DF2\u505C\u6B62\u641C\u7D22 \xB7 \u5F53\u524D ${count} \u6761\u7ED3\u679C\u672A\u8986\u76D6\u5168\u90E8\u8D44\u6599\u3002`
      }[state.status];
      if (state.changed && ["idle", "complete", "empty", "no-match"].includes(state.status)) status.textContent = `\u8D44\u6599\u5DF2\u53D8\u5316\uFF0C\u5F53\u524D\u663E\u793A\u4E0A\u6B21\u641C\u7D22\u7ED3\u679C\uFF08${count} \u6761\uFF09\u3002\u8BF7\u5237\u65B0\u7ED3\u679C\u3002`;
      root.dataset.stale = String(state.changed);
      root.dataset.status = state.status;
      warning.textContent = [state.changed ? "\u5DF2\u4FDD\u5B58\u7684\u5185\u5BB9\u6216\u6536\u85CF\u5DF2\u53D8\u5316\u3002\u5F53\u524D\u7ED3\u679C\u6765\u81EA\u641C\u7D22\u5F00\u59CB\u65F6\u7684\u8D44\u6599\uFF0C\u8BF7\u5237\u65B0\u7ED3\u679C\u3002" : "", ...state.errors.map((e) => `\u8BFB\u53D6\u5931\u8D25\uFF1A${e.message}`)].filter(Boolean).join("\n");
      retry.hidden = !["partial", "failed"].includes(state.status);
      restart.hidden = !state.changed && !["partial", "failed", "cancelled", "complete", "no-match"].includes(state.status);
      cancel.hidden = state.status !== "searching";
      if (reset) message.textContent = "";
    }
    const controller = createLibrarySearch({ changed });
    chrome.storage.onChanged.addListener((changes, area) => {
      const libraryKeys = ["snooper.library.favorites.v1", "snooper.library.deletions.v1", "snooper.notes.v1", "snooper.notes.migration.v1", "snooper.extension.transcripts.v1", "snooper.extension.transcript-deletions.v1", "snooper.extension.history.v1"];
      if (area === "local" && Object.keys(changes).some((key) => libraryKeys.includes(key) || key.startsWith("snooper.extension.transcript.v1."))) {
        controller.state.changed = true;
        changed(controller.state, [], false);
        if (changes["snooper.library.deletions.v1"] || changes["snooper.extension.transcript-deletions.v1"]) void refreshUsage();
      }
    });
    const input = () => controller.input(query.value, filter.checked);
    query.addEventListener("input", input);
    filter.addEventListener("change", input);
    retry.addEventListener("click", () => {
      void controller.retry();
    });
    restart.addEventListener("click", () => {
      void controller.start(query.value, filter.checked);
      void results.refreshFavorites();
      void refreshUsage();
    });
    cancel.addEventListener("click", controller.cancel);
    document.getElementById("library-manage-history").addEventListener("click", () => showTab("history"));
    document.getElementById("library-manage-notes").addEventListener("click", () => showTab("notes"));
    document.getElementById("library-refresh-usage").addEventListener("click", () => {
      void refreshUsage();
    });
    let usageSequence = 0;
    async function refreshUsage() {
      const sequence = ++usageSequence;
      usage.textContent = "\u6B63\u5728\u8BFB\u53D6\u672C\u5730\u5B58\u50A8\u72B6\u6001\u2026";
      try {
        const response = await libraryRequest("LIBRARY_USAGE");
        requireSuccess(response);
        if (sequence !== usageSequence) return;
        const stats = response;
        const number = (value) => value === null ? "\u8BFB\u53D6\u5931\u8D25" : String(value);
        usage.textContent = "";
        usage.append(element("p", "", `\u672C\u5730\u6269\u5C55\u5B58\u50A8 ${stats.bytes === null ? "\u8BFB\u53D6\u5931\u8D25" : (stats.bytes / 1024 / 1024).toFixed(2) + " MB"}\uFF08\u5305\u542B\u8BBE\u7F6E\u4E0E\u9644\u4EF6\uFF09\u3002${number(stats.transcriptCount)} \u6761\u8F6C\u5199\u8BB0\u5F55 \xB7 ${number(stats.noteCount)} \u7BC7\u7B14\u8BB0 / ${number(stats.noteEntryCount)} \u6761\u5185\u5BB9 \xB7 ${number(stats.favoriteCount)} \u6761\u6536\u85CF\u3002`));
        usage.append(element("p", "section-desc", "\u6B63\u6587\u4E0D\u4F1A\u6309\u6570\u91CF\u6216\u65F6\u95F4\u81EA\u52A8\u6E05\u7406\u3002\u53EF\u524D\u5F80\u8F6C\u5199\u6216\u7B14\u8BB0\u5386\u53F2\u5BFC\u51FA\uFF0C\u518D\u624B\u52A8\u5220\u9664\u4E0D\u9700\u8981\u7684\u8D44\u6599\u3002"));
        if (stats.pendingWrites.transcriptLines || stats.pendingWrites.noteMigration || stats.pendingWrites.noteMigration === null) usage.append(element("p", "library-warning", `${stats.pendingWrites.transcriptLines} \u6761\u5B57\u5E55\u5C1A\u672A\u4FDD\u5B58\u3002${stats.pendingWrites.noteMigration ? "\u65E7\u7B14\u8BB0\u4ECD\u5F85\u5408\u5E76\u3002" : stats.pendingWrites.noteMigration === null ? "\u65E7\u7B14\u8BB0\u5408\u5E76\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\u3002" : ""}\u8BF7\u5728\u7B14\u8BB0\u9875\u91CD\u8BD5\u4FDD\u5B58\u6216\u5BFC\u51FA\u53EF\u7528\u5185\u5BB9\uFF1B\u9875\u9762\u5185\u7B14\u8BB0\u8349\u7A3F\u8BF7\u5728\u539F\u9875\u9762\u5904\u7406\u3002`));
        if (!stats.complete) usage.append(element("p", "library-warning", `\u5B58\u50A8\u72B6\u6001\u672A\u5B8C\u6574\u8BFB\u53D6\uFF1A${stats.errors.map((e) => e.message).join("\uFF1B")}`));
        if (stats.pendingDeletes === null) usage.append(element("p", "library-warning", "\u672A\u5B8C\u6210\u5220\u9664\u7684\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002"));
        for (const operation of stats.pendingDeletes || []) {
          const line = element("div", "library-pending-delete");
          line.append(element("p", "", `${operation.pending.length} \u9879\u5220\u9664\u672A\u5B8C\u6210\uFF1A${operation.pending.map((p) => p.error).join("\uFF1B")}`));
          const again = button("\u91CD\u8BD5\u5220\u9664", "retry-delete", async () => {
            again.disabled = true;
            try {
              const result = await libraryRequest("LIBRARY_RETRY_DELETE", { operationId: operation.operationId });
              requireSuccess(result);
              const pending = result.pending;
              notify(pending.length ? `\u4ECD\u6709 ${pending.length} \u9879\u5220\u9664\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u5B58\u50A8\u540E\u518D\u8BD5` : "\u5DF2\u5B8C\u6210\u8FD9\u6B21\u5220\u9664");
            } catch (error) {
              notify(`\u5220\u9664\u91CD\u8BD5\u5931\u8D25\uFF1A${String(error)}`);
            }
            await refreshUsage();
          });
          line.append(again);
          usage.append(line);
        }
      } catch (error) {
        if (sequence === usageSequence) usage.textContent = `\u5B58\u50A8\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}\u3002\u8BF7\u70B9\u51FB\u5237\u65B0\u72B6\u6001\u91CD\u8BD5\u3002`;
      }
    }
    return { activate() {
      void refreshUsage();
      void results.refreshFavorites();
      if (["idle", "complete", "empty", "no-match"].includes(controller.state.status)) void controller.start(query.value, filter.checked);
    }, controller };
  }

  // src/lib/video-key.ts
  function stripWww(host) {
    return host.replace(/^www\./, "");
  }
  function youtubeId(url) {
    const host = stripWww(url.hostname);
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    const direct = url.searchParams.get("v");
    if (direct) return direct;
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
  function bilibiliKey(url) {
    const host = stripWww(url.hostname);
    if (host !== "bilibili.com" && !host.endsWith(".bilibili.com")) return null;
    const bv = url.pathname.match(/\/(BV[0-9A-Za-z]+)/);
    if (bv?.[1]) return `bilibili:${bv[1]}`;
    const av = url.pathname.match(/\/av(\d+)/i);
    if (av?.[1]) return `bilibili:av${av[1]}`;
    const episode = url.pathname.match(/^\/(bangumi|cheese)\/play\/(ep\d+)(?:\/|$)/);
    if (episode) return `bilibili:${episode[1]}/play/${episode[2]}`;
    return null;
  }
  function bilibiliPart(url) {
    if (!url.searchParams.has("p")) return 1;
    const parts = url.searchParams.getAll("p");
    if (parts.length !== 1 || !/^[1-9]\d*$/.test(parts[0])) return null;
    const n = Number(parts[0]);
    return Number.isSafeInteger(n) ? n : null;
  }
  function legacySourceRef(url, title, scope) {
    return { key: `legacy:${scope}`, url, title, confidence: url ? "legacy" : "unknown" };
  }

  // src/ext/content/library-client.ts
  async function confirmLibraryDelete(selection) {
    const preview = await libraryRequest("LIBRARY_PREPARE_DELETE", selection);
    requireSuccess(preview);
    const targets = preview.targets;
    const skipped = preview.skipped;
    if (!targets.length) throw new Error(skipped[0]?.reason || "\u6CA1\u6709\u53EF\u5220\u9664\u7684\u8D44\u6599");
    const transcripts = targets.filter((t) => t.kind === "transcript").length;
    const notes = targets.filter((t) => t.kind === "note");
    const noteEntries = notes.reduce((sum, t) => sum + (t.kind === "note" ? t.entryIds.length : 0), 0);
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "library-delete-dialog";
    dialog.setAttribute("aria-label", "\u786E\u8BA4\u5220\u9664\u8D44\u6599");
    dialog.style.cssText = "max-width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;border-radius:12px;border:1px solid var(--border-color,GrayText);background:var(--bg-secondary,Canvas);color:var(--text-main,CanvasText);margin:auto;line-height:1.7";
    const heading = document.createElement("h2");
    heading.textContent = "\u786E\u8BA4\u5220\u9664\u8D44\u6599";
    heading.style.fontSize = "18px";
    const summary = document.createElement("p");
    summary.dataset.testid = "delete-impact";
    summary.textContent = `\u5C06\u5220\u9664 ${transcripts} \u6761\u8F6C\u5199\u8BB0\u5F55\u3001${noteEntries} \u6761\u7B14\u8BB0\u5185\u5BB9\uFF0C\u540C\u65F6\u79FB\u9664 ${preview.favoriteCount} \u6761\u6536\u85CF\u3002\u72EC\u7ACB\u53E6\u5B58\u7684\u7B14\u8BB0\u4F1A\u4FDD\u7559\u3002\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`;
    const status = document.createElement("p");
    status.setAttribute("role", "alert");
    status.style.overflowWrap = "anywhere";
    if (skipped.length) status.textContent = `${skipped.length} \u9879\u5DF2\u8DF3\u8FC7\uFF1A${skipped.map((s) => s.reason).join("\uFF1B")}`;
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:14px";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "\u53D6\u6D88";
    cancel.dataset.action = "cancel-delete";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-danger";
    confirm.textContent = "\u786E\u8BA4\u5220\u9664";
    confirm.dataset.action = "confirm-delete";
    actions.append(cancel, confirm);
    dialog.append(heading, summary, status, actions);
    document.body.append(dialog);
    return new Promise((resolve) => {
      let result = null;
      let busy = false;
      let stale = false;
      dialog.addEventListener("cancel", (event) => {
        if (busy) event.preventDefault();
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        previousFocus?.focus();
        resolve(result);
      }, { once: true });
      cancel.addEventListener("click", () => dialog.close());
      confirm.addEventListener("click", async () => {
        busy = true;
        confirm.disabled = true;
        cancel.disabled = true;
        status.textContent = "\u6B63\u5728\u5220\u9664\u2026";
        try {
          const response = await libraryRequest("LIBRARY_DELETE", { token: preview.token });
          requireSuccess(response);
          const deletion = response;
          if (deletion.pending.length) {
            status.textContent = `\u5DF2\u5B8C\u6210 ${deletion.completed.length} \u9879\uFF0C${deletion.pending.length} \u9879\u5C1A\u672A\u5B8C\u6210\uFF1A${deletion.pending.map((p) => p.error).join("\uFF1B")}\u3002\u53EF\u91CD\u8BD5\uFF0C\u6216\u7A0D\u540E\u5728\u641C\u7D22\u9875\u7684\u5B58\u50A8\u72B6\u6001\u4E2D\u5904\u7406\u3002`;
          } else {
            result = deletion;
            dialog.close();
            return;
          }
        } catch (error) {
          stale = !!error && typeof error === "object" && "code" in error && error.code === "CONFIRMATION_STALE";
          status.textContent = `\u5220\u9664\u672A\u5B8C\u6210\uFF1A${error instanceof Error ? error.message : String(error)}${stale ? "\u3002\u8BF7\u5173\u95ED\u540E\u91CD\u65B0\u9009\u62E9\uFF0C\u6838\u5BF9\u6700\u65B0\u5F71\u54CD\u6570\u91CF\u3002" : ""}`;
        } finally {
          busy = false;
          confirm.disabled = stale;
          cancel.disabled = false;
        }
        confirm.textContent = stale ? "\u8BF7\u91CD\u65B0\u9884\u89C8" : "\u91CD\u8BD5\u5220\u9664";
        cancel.textContent = "\u7A0D\u540E\u5904\u7406";
      });
      dialog.showModal();
      cancel.focus();
    });
  }

  // src/ext/content/notes-store.ts
  var NOTES_STORAGE_KEY = "snooper.notes.v1";
  var retainedLegacySnapshot = null;
  async function requestResult(type, fields = {}) {
    const result = await chrome.runtime.sendMessage({ target: "background", type, ...fields });
    if (!result?.ok || !Array.isArray(result.notes)) throw new Error(result?.error || "\u7B14\u8BB0\u4FDD\u5B58\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u6216\u5BFC\u51FA");
    return result;
  }
  async function request(type, fields = {}) {
    return (await requestResult(type, fields)).notes;
  }
  function hasRetainedLegacyNotes() {
    return retainedLegacySnapshot !== null;
  }
  function readRetainedLegacyNotes() {
    try {
      return localStorage.getItem(NOTES_STORAGE_KEY) ?? retainedLegacySnapshot;
    } catch {
      return retainedLegacySnapshot;
    }
  }
  function exportRetainedLegacyNotes() {
    const raw = readRetainedLegacyNotes();
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "snooper-legacy-notes.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  async function loadNotes() {
    let legacy;
    let submitted = null;
    try {
      submitted = localStorage.getItem(NOTES_STORAGE_KEY);
      if (submitted) legacy = JSON.parse(submitted);
    } catch {
    }
    retainedLegacySnapshot = submitted;
    const result = await requestResult("NOTES_LIST", { legacy });
    try {
      const current = localStorage.getItem(NOTES_STORAGE_KEY);
      if (submitted && current === submitted && result.legacyAcknowledged === true) {
        localStorage.removeItem(NOTES_STORAGE_KEY);
        retainedLegacySnapshot = null;
      } else {
        retainedLegacySnapshot = current;
        if (current === submitted && Array.isArray(legacy) && legacy.length === 0) retainedLegacySnapshot = null;
      }
    } catch {
    }
    return result.notes;
  }
  async function deleteNoteDocuments(ids) {
    if (!await confirmLibraryDelete({ noteIds: ids })) return null;
    return request("NOTES_LIST");
  }

  // src/ext/action-flow.ts
  var UnsupportedPageError = class extends Error {
    code = "UNSUPPORTED_PAGE";
    constructor() {
      super("\u6B64\u9875\u9762\u53D7\u6D4F\u89C8\u5668\u9650\u5236\uFF0C\u65E0\u6CD5\u8FD0\u884C snooper\u3002\u8BF7\u5207\u6362\u5230\u666E\u901A\u7F51\u9875\u540E\u91CD\u8BD5\u3002");
      this.name = "UnsupportedPageError";
    }
  };
  var CONTENT_SCRIPT_FILE = "content.js";
  async function injectContentScriptFresh(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        delete globalThis.__rttsContentInstalled;
      }
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    });
  }
  function isUnsupportedTabUrl(url) {
    return /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url || "") || /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?:\/|$)/i.test(url || "");
  }
  async function sendToPageWithInjection(tabId, message, tabUrl, { sendMessage, injectContentScript, collectResponse }) {
    if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError();
    try {
      const raw = await sendMessage(tabId, message);
      return {
        ok: true,
        injected: false,
        ...collectResponse ? { responseOk: collectResponse(raw) } : {}
      };
    } catch (firstError) {
      try {
        await injectContentScript(tabId);
        const raw = await sendMessage(tabId, message);
        return {
          ok: true,
          injected: true,
          ...collectResponse ? { responseOk: collectResponse(raw) } : {}
        };
      } catch (retryError) {
        const error = retryError instanceof Error ? retryError : new Error(String(retryError));
        if (firstError instanceof Error) error.cause ??= firstError;
        throw error;
      }
    }
  }

  // src/lib/export-assets.ts
  function decodeExportAsset(asset) {
    if (asset.mimeType === "image/svg+xml" && asset.svgText) {
      return { file: { name: asset.fileName, bytes: new TextEncoder().encode(asset.svgText) } };
    }
    const dataUrl = asset.dataUrl || "";
    const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl);
    if (!match) return null;
    const mime = match[1] || "image/png";
    if (mime !== asset.mimeType) return null;
    try {
      const binary = atob(match[2] || "");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { file: { name: asset.fileName, bytes } };
    } catch {
      return null;
    }
  }
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function buildZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const entries = [];
    let offset = 0;
    const push = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };
    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const crc = crc32(file.bytes);
      const size = file.bytes.length;
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 67324752, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 2048, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 33, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, size, true);
      view.setUint32(22, size, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      header.set(nameBytes, 30);
      push(header);
      push(file.bytes);
      entries.push({ nameBytes, crc, size, offset: offset - size, bytes: file.bytes });
    }
    const centralStart = offset;
    for (const entry of entries) {
      const central = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 33639248, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 2048, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 33, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.offset, true);
      central.set(entry.nameBytes, 46);
      push(central);
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 101010256, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, offset - centralStart, true);
    endView.setUint32(16, centralStart, true);
    push(end);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      out.set(chunk, position);
      position += chunk.length;
    }
    return out;
  }
  function collectAssets(notes, messages, options = {}) {
    const assets = [];
    const used = options.existingNames || /* @__PURE__ */ new Set();
    const stamp = Date.now();
    const uniqueName = (base, ext) => {
      let index = assets.length + 1;
      let name = `${base}-${stamp}-${index}.${ext}`;
      while (used.has(name)) {
        index += 1;
        name = `${base}-${stamp}-${index}.${ext}`;
      }
      used.add(name);
      return name;
    };
    const extFor = (mime) => mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("svg") ? "svg" : "png";
    notes.forEach((note) => note.entries.forEach((entry) => {
      const entryId = `note:${note.id}:${entry.id}`;
      if ((entry.type === "image" || entry.type === "screenshot") && entry.imageUrl?.startsWith("data:")) {
        const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || "image/png";
        assets.push({
          entryId,
          fileName: uniqueName("snooper", extFor(mime)),
          mimeType: mime,
          dataUrl: entry.imageUrl
        });
      } else if (entry.type === "svg" && entry.svg) {
        assets.push({
          entryId,
          fileName: uniqueName("snooper", "svg"),
          mimeType: "image/svg+xml",
          svgText: entry.svg
        });
      }
    }));
    messages.forEach((message, messageIndex) => (message.images || []).forEach((image, imageIndex) => {
      if (!image.startsWith("data:")) return;
      const mime = /^data:([^;,]+)/.exec(image)?.[1] || "image/png";
      assets.push({
        entryId: `chat:${messageIndex}:${imageIndex}`,
        fileName: uniqueName("snooper-chat", extFor(mime)),
        mimeType: mime,
        dataUrl: image
      });
    }));
    return assets;
  }

  // src/lib/deep-link.ts
  function floorSeconds(seconds) {
    return Math.max(0, Math.floor(seconds));
  }
  function videoDeepLink(url, seconds) {
    if (!url || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const t = floorSeconds(seconds);
    if (bilibiliKey(parsed)) {
      const part = bilibiliPart(parsed);
      if (part === null) return null;
      return `https://www.bilibili.com${parsed.pathname}?${parsed.searchParams.has("p") ? `p=${part}&` : ""}t=${t}`;
    }
    const yt = youtubeId(parsed);
    if (yt) {
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "youtu.be") return `https://youtu.be/${yt}?t=${t}s`;
      if (parsed.pathname.startsWith("/shorts/")) return `https://www.youtube.com/shorts/${yt}?t=${t}s`;
      return `https://www.youtube.com/watch?v=${yt}&t=${t}s`;
    }
    return null;
  }

  // src/ext/sidepanel/panel.ts
  (() => {
    const DEFAULT_OBSIDIAN = {
      enabled: false,
      vaultPath: "",
      apiProtocol: "http",
      apiPort: 27123,
      apiKey: "",
      noteFolder: "snooper-notes"
    };
    const OBSIDIAN_KEY = "snooper.obsidian-config.v1";
    function normalizeObsidianConfig(raw) {
      const r = raw && typeof raw === "object" ? raw : {};
      const port = Number(r.apiPort) || DEFAULT_OBSIDIAN.apiPort;
      const protocol = r.apiProtocol === "https" || r.apiProtocol === "http" ? r.apiProtocol : port === 27124 ? "https" : "http";
      return {
        enabled: !!r.enabled,
        vaultPath: typeof r.vaultPath === "string" ? r.vaultPath : "",
        apiProtocol: protocol,
        apiPort: port,
        // Users copy the plugin's "Bearer <token>" line; store only the token.
        apiKey: typeof r.apiKey === "string" ? r.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "",
        noteFolder: typeof r.noteFolder === "string" && r.noteFolder.trim() ? r.noteFolder.trim() : DEFAULT_OBSIDIAN.noteFolder
      };
    }
    async function loadObsidianConfig() {
      try {
        const got = await chrome.storage.local.get(OBSIDIAN_KEY);
        const stored = got?.[OBSIDIAN_KEY];
        if (stored && typeof stored === "object") return normalizeObsidianConfig(stored);
      } catch {
      }
      try {
        const raw = localStorage.getItem(OBSIDIAN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const config = normalizeObsidianConfig(parsed);
          try {
            await chrome.storage.local.set({ [OBSIDIAN_KEY]: config });
          } catch {
          }
          return config;
        }
      } catch {
      }
      return { ...DEFAULT_OBSIDIAN };
    }
    async function saveObsidianConfig(config) {
      const normalized = normalizeObsidianConfig(config);
      try {
        await chrome.storage.local.set({ [OBSIDIAN_KEY]: normalized });
      } catch {
      }
      try {
        localStorage.setItem(OBSIDIAN_KEY, JSON.stringify(normalized));
      } catch {
      }
    }
    let obsidianCfg = { ...DEFAULT_OBSIDIAN };
    let notes = [];
    let noteAssetNames = /* @__PURE__ */ new Map();
    const noticeBanner = document.getElementById("noticeBanner");
    const tabNotes = document.getElementById("tab-notes");
    const tabObsidian = document.getElementById("tab-obsidian");
    const tabHistory = document.getElementById("tab-history");
    const notesList = document.getElementById("notes-list");
    const notesRefreshBtn = document.getElementById("notes-refresh-btn");
    const notesSelectAll = document.getElementById("notes-select-all");
    const notesDeleteSelected = document.getElementById("notes-delete-selected");
    const openPageConfigBtn = document.getElementById("open-page-config");
    const obsidianEnabled = document.getElementById("obsidian-enabled");
    const obsidianProtocol = document.getElementById("obsidian-protocol");
    const obsidianPort = document.getElementById("obsidian-port");
    const obsidianFolder = document.getElementById("obsidian-folder");
    const obsidianKey = document.getElementById("obsidian-key");
    const obsidianTest = document.getElementById("obsidian-test");
    const obsidianTestStatus = document.getElementById("obsidian-test-status");
    const saveConfigBtn = document.getElementById("saveConfigBtn");
    const historyList = document.getElementById("history-list");
    const historyEmpty = document.getElementById("history-empty");
    const historyCount = document.getElementById("history-count");
    const historySelectAll = document.getElementById("history-select-all");
    const historyDeleteSelected = document.getElementById("history-delete-selected");
    const historyClear = document.getElementById("history-clear");
    function showNotice(text, isError = false) {
      noticeBanner.textContent = text;
      noticeBanner.className = `notice-banner ${isError ? "error" : "success"}`;
      noticeBanner.hidden = false;
      setTimeout(() => {
        noticeBanner.hidden = true;
      }, 4e3);
    }
    function switchTab(tab) {
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.remove("active");
        btn.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
      const nextTab = document.getElementById(`tab-${tab}`);
      nextTab?.classList.add("active");
      nextTab?.setAttribute("aria-selected", "true");
      document.getElementById(`panel-${tab}`)?.classList.add("active");
      document.querySelector(".panel-footer").hidden = tab !== "obsidian";
      if (tab === "search") library.activate();
      if (tab === "notes") void loadAndRenderNotes();
      if (tab === "history") void loadAndRenderHistory();
    }
    const library = mountLibraryPanel(switchTab);
    document.getElementById("tab-search").addEventListener("click", () => switchTab("search"));
    tabNotes.addEventListener("click", () => switchTab("notes"));
    tabObsidian.addEventListener("click", () => switchTab("obsidian"));
    tabHistory.addEventListener("click", () => switchTab("history"));
    openPageConfigBtn?.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("\u6CA1\u6709\u6D3B\u52A8\u6807\u7B7E\u9875");
        await sendToPageWithInjection(tab.id, { type: "OPEN_PAGE_SETTINGS" }, tab.url, {
          sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
          injectContentScript: injectContentScriptFresh
        });
        showNotice("\u5DF2\u6253\u5F00\u9875\u9762\u914D\u7F6E");
      } catch (err) {
        showNotice(err instanceof Error ? err.message : "\u6253\u5F00\u914D\u7F6E\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002", true);
      }
    });
    function getSelectedNoteIds() {
      return Array.from(notesList.querySelectorAll("input.note-check:checked")).map((el) => el.dataset.id || "").filter(Boolean);
    }
    function updateNoteSelection() {
      const all = Array.from(notesList.querySelectorAll("input.note-check"));
      const selected = all.filter((el) => el.checked);
      notesDeleteSelected.disabled = selected.length === 0;
      notesDeleteSelected.textContent = selected.length > 0 ? `\u5220\u9664\u6240\u9009 (${selected.length})` : "\u5220\u9664\u6240\u9009";
      notesSelectAll.checked = all.length > 0 && selected.length === all.length;
      notesSelectAll.indeterminate = selected.length > 0 && selected.length < all.length;
      notesSelectAll.disabled = all.length === 0;
    }
    const saveFailures = document.createElement("div");
    saveFailures.setAttribute("role", "status");
    notesList.before(saveFailures);
    async function renderSaveFailures() {
      try {
        const result = await chrome.runtime.sendMessage({ target: "background", type: "GET_SAVE_FAILURES" });
        if (!result?.ok) return;
        saveFailures.textContent = "";
        for (const failure of result.failures || []) {
          const item = document.createElement("p");
          item.className = "empty-hint";
          item.textContent = `\u6709\u5185\u5BB9\u672A\u4FDD\u5B58\uFF08${failure.pendingCount} \u6761\u5F85\u4FDD\u5B58\uFF09\uFF1A${failure.saveState.message}`;
          const retry = document.createElement("button");
          retry.textContent = "\u91CD\u8BD5\u4FDD\u5B58";
          retry.className = "btn btn-sm btn-secondary";
          retry.addEventListener("click", async () => {
            retry.disabled = true;
            try {
              const res = await chrome.runtime.sendMessage({ target: "background", type: "RETRY_TRANSCRIPT", tabId: failure.tabId });
              if (!res?.ok) showNotice(res?.error || "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5BFC\u51FA");
            } catch (error) {
              showNotice(`\u4FDD\u5B58\u5931\u8D25\uFF1A${String(error)}`);
            }
            await renderSaveFailures();
          });
          const exportBtn = document.createElement("button");
          exportBtn.textContent = "\u5BFC\u51FA\u53EF\u7528\u5185\u5BB9";
          exportBtn.className = "btn btn-sm btn-secondary";
          exportBtn.addEventListener("click", async () => {
            try {
              const res = await chrome.runtime.sendMessage({ target: "background", type: "GET_TRANSCRIPT", tabId: failure.tabId });
              const lines = Array.isArray(res?.subtitles) ? res.subtitles : [];
              if (!lines.length) {
                showNotice(res?.error || "\u6682\u65E0\u53EF\u5BFC\u51FA\u5185\u5BB9\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6");
                return;
              }
              const text = lines.map((line) => `${line.source}
${line.target}`).join("\n\n");
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = "snooper-unsaved-transcript.txt";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 2e3);
              showNotice(res.complete ? "\u5DF2\u5BFC\u51FA\u5F53\u524D\u8F6C\u5199\uFF08\u542B\u672A\u4FDD\u5B58\u5185\u5BB9\uFF09" : "\u4EC5\u5BFC\u51FA\u53EF\u7528\u5185\u5BB9\uFF0C\u90E8\u5206\u6B63\u6587\u8BFB\u53D6\u5931\u8D25");
            } catch (error) {
              showNotice(`\u5BFC\u51FA\u5931\u8D25\uFF1A${String(error)}`);
            }
          });
          item.style.overflowWrap = "anywhere";
          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
          actions.append(retry, exportBtn);
          item.appendChild(actions);
          saveFailures.appendChild(item);
        }
      } catch (error) {
        showNotice(`\u4FDD\u5B58\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}`);
      }
    }
    const legacyWarning = document.createElement("p");
    notesList.before(legacyWarning);
    function renderLegacyWarning() {
      legacyWarning.textContent = "";
      legacyWarning.hidden = !hasRetainedLegacyNotes();
      if (hasRetainedLegacyNotes()) {
        legacyWarning.className = "empty-hint";
        legacyWarning.setAttribute("role", "status");
        legacyWarning.textContent = "\u4FA7\u680F\u65E7\u7248\u7B14\u8BB0\u5C1A\u672A\u786E\u8BA4\u5408\u5E76\uFF0C\u539F\u526F\u672C\u5DF2\u4FDD\u7559\u3002\u8BF7\u5BFC\u51FA\u65E7\u526F\u672C\uFF1B\u68C0\u7D22\u53EA\u5305\u542B\u5DF2\u4FDD\u5B58\u8D44\u6599\u3002";
        const exportLegacy = document.createElement("button");
        exportLegacy.textContent = "\u5BFC\u51FA\u65E7\u7248\u526F\u672C";
        exportLegacy.className = "btn btn-sm btn-secondary";
        exportLegacy.addEventListener("click", exportRetainedLegacyNotes);
        legacyWarning.appendChild(exportLegacy);
      }
    }
    async function loadAndRenderNotes() {
      await renderSaveFailures();
      try {
        notes = await loadNotes();
      } catch (error) {
        showNotice(`\u7B14\u8BB0\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u70B9\u5237\u65B0\u91CD\u8BD5\uFF1A${String(error)}`);
        return;
      } finally {
        renderLegacyWarning();
      }
      disposeFavoriteControls(notesList);
      notesList.textContent = "";
      if (notes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-hint";
        empty.textContent = "\u6682\u65E0\u7B14\u8BB0\u3002\u5728\u9875\u9762\u6D6E\u5C42\u70B9\u51FB\u300C\u8BB0\u7B14\u8BB0\u300D\u6216\u300C\u751F\u6210\u914D\u56FE\u300D\u5373\u53EF\u6DFB\u52A0\u3002";
        notesList.appendChild(empty);
        updateNoteSelection();
        return;
      }
      const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
      sorted.forEach((note) => {
        const card = document.createElement("div");
        card.className = "note-card";
        const header = document.createElement("div");
        header.className = "note-card-header";
        const select = document.createElement("input");
        select.type = "checkbox";
        select.className = "note-check";
        select.dataset.id = note.id;
        select.setAttribute("aria-label", `\u9009\u62E9 ${note.title || "\u7B14\u8BB0"}`);
        select.addEventListener("change", updateNoteSelection);
        const title = document.createElement("span");
        title.className = "note-card-title";
        title.textContent = note.title || "\u672A\u547D\u540D\u7B14\u8BB0";
        const count = document.createElement("span");
        count.className = "note-card-count";
        count.textContent = `${note.entries.length} \u6761`;
        const titleWrap = document.createElement("div");
        titleWrap.className = "note-card-title-wrap";
        titleWrap.appendChild(select);
        titleWrap.appendChild(title);
        header.appendChild(titleWrap);
        header.appendChild(count);
        card.appendChild(header);
        const meta = document.createElement("div");
        meta.className = "note-card-meta";
        const date = new Date(note.updatedAt).toLocaleString("zh-CN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        meta.textContent = `\u66F4\u65B0\u4E8E ${date}`;
        card.appendChild(meta);
        if (note.entries.length > 0) {
          const preview = document.createElement("div");
          preview.className = "note-card-preview";
          const last = note.entries[note.entries.length - 1];
          preview.textContent = last.text || last.target || last.source || "(\u7A7A)";
          card.appendChild(preview);
        }
        const actions = document.createElement("div");
        actions.className = "note-card-actions";
        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "btn btn-ghost btn-xs";
        exportBtn.textContent = "\u5BFC\u51FA Markdown";
        exportBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          exportNote(note);
        });
        actions.appendChild(exportBtn);
        const detail = document.createElement("div");
        detail.className = "note-entry-detail";
        detail.hidden = true;
        let shown = 0;
        const rows = document.createElement("div");
        const more = document.createElement("button");
        more.type = "button";
        more.className = "btn btn-sm btn-secondary";
        more.dataset.action = "note-more";
        function paintNotes() {
          const end = Math.min(note.entries.length, shown + 50);
          for (; shown < end; shown++) {
            const entry = note.entries[shown];
            rows.append(renderEntry({
              ref: { kind: "note", noteId: note.id, entryId: entry.id },
              sourceRef: entry.sourceRef || legacySourceRef(entry.videoUrl || "", note.title, note.id),
              title: note.title,
              at: entry.at,
              videoTime: entry.videoTime ?? null,
              source: entry.source || "",
              target: entry.target || "",
              text: entry.text || "",
              type: entry.type
            }, (text) => showNotice(text)));
          }
          more.hidden = shown >= note.entries.length;
          more.textContent = `\u663E\u793A\u66F4\u591A\uFF08\u5269\u4F59 ${note.entries.length - shown} \u6761\uFF09`;
        }
        more.addEventListener("click", paintNotes);
        detail.append(rows, more);
        const view = document.createElement("button");
        view.type = "button";
        view.className = "btn btn-ghost btn-xs";
        view.textContent = "\u67E5\u770B\u5168\u90E8\u5185\u5BB9";
        view.dataset.action = "note-detail";
        view.addEventListener("click", () => {
          detail.hidden = !detail.hidden;
          view.textContent = detail.hidden ? "\u67E5\u770B\u5168\u90E8\u5185\u5BB9" : "\u6536\u8D77\u5185\u5BB9";
          if (!shown) paintNotes();
        });
        actions.appendChild(view);
        card.appendChild(detail);
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-btn icon-btn-danger";
        delBtn.setAttribute("aria-label", `\u5220\u9664${note.title || "\u7B14\u8BB0"}`);
        delBtn.title = "\u5220\u9664\u7B14\u8BB0";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const updated = await deleteNoteDocuments([note.id]);
            if (!updated) return;
            notes = updated;
            await loadAndRenderNotes();
            showNotice("\u7B14\u8BB0\u5DF2\u5220\u9664");
          } catch (error) {
            showNotice(`\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${String(error)}`);
          }
        });
        actions.appendChild(delBtn);
        card.appendChild(actions);
        notesList.appendChild(card);
      });
      updateNoteSelection();
    }
    function exportNote(note) {
      const assets = collectAssets([note], []).map((asset) => ({
        ...asset,
        entryId: asset.entryId.replace(/^note:[^:]+:/, `note:${note.id}:`)
      }));
      const decoded = [];
      noteAssetNames = /* @__PURE__ */ new Map();
      for (const asset of assets) {
        const result = decodeExportAsset(asset);
        if (result) {
          noteAssetNames.set(asset.entryId, asset.fileName);
          decoded.push({ name: `assets/${asset.fileName}`, bytes: result.file.bytes });
        }
      }
      const lines = [
        `# ${note.title}`,
        "",
        `- **\u521B\u5EFA\u65F6\u95F4**\uFF1A${new Date(note.createdAt).toLocaleString("zh-CN")}`,
        `- **\u6761\u76EE\u6570**\uFF1A${note.entries.length}`,
        "",
        "---",
        ""
      ];
      for (const entry of note.entries) {
        const time = new Date(entry.at).toLocaleTimeString("zh-CN");
        switch (entry.type) {
          case "subtitle": {
            lines.push(`### \u5B57\u5E55 ${time}`);
            if (entry.target) lines.push(`**\u8BD1\u6587**\uFF1A${entry.target}`);
            if (entry.source) lines.push(`**\u539F\u6587**\uFF1A${entry.source}`);
            const link = entry.sourceRef?.confidence === "exact" && typeof entry.videoTime === "number" && Number.isFinite(entry.videoTime) ? videoDeepLink(entry.sourceRef.url, entry.videoTime) : null;
            if (link) lines.push(`**\u89C6\u9891\u951A\u70B9**\uFF1A[\`${formatVideoTime(entry.videoTime)}\`](${link})`);
            lines.push("");
            break;
          }
          case "text":
            lines.push(`### \u7B14\u8BB0 ${time}`);
            lines.push(entry.text || "");
            lines.push("");
            break;
          case "summary":
            lines.push(`### \u5B66\u4E60\u7EAA\u8981 ${time}`);
            lines.push(entry.text || "");
            lines.push("");
            break;
          case "screenshot":
          case "image": {
            const title = entry.type === "screenshot" ? "\u622A\u56FE" : "\u914D\u56FE";
            lines.push(`### ${title} ${time}`);
            lines.push(entry.text || entry.source || title);
            const assetName = noteAssetNames.get(`note:${note.id}:${entry.id}`);
            if (assetName) lines.push(`![](assets/${assetName})`);
            else lines.push(`> [\u56FE\u7247\uFF1A${entry.text || title} \u2014 \u56FE\u7247\u6570\u636E\u672A\u80FD\u968F\u5BFC\u51FA\u643A\u5E26]`);
            lines.push("");
            break;
          }
          case "svg": {
            lines.push(`### SVG ${time}`);
            lines.push(entry.text || entry.source || "");
            const svgName = noteAssetNames.get(`note:${note.id}:${entry.id}`);
            if (svgName) lines.push(`![](assets/${svgName})`);
            else if (entry.svg) lines.push("```svg\n" + entry.svg + "\n```");
            lines.push("");
            break;
          }
        }
      }
      lines.push("", "---", "*\u7531 snooper-browser \u751F\u6210*");
      const markdown = lines.join("\n");
      if (decoded.length === 0) {
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.md`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 2e3);
        showNotice("\u7B14\u8BB0\u5DF2\u5BFC\u51FA");
        return;
      }
      decoded.unshift({ name: "note.md", bytes: new TextEncoder().encode(markdown) });
      const zipBlob = new Blob([buildZip(decoded)], { type: "application/zip" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const zipAnchor = document.createElement("a");
      zipAnchor.href = zipUrl;
      zipAnchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.zip`;
      zipAnchor.click();
      setTimeout(() => URL.revokeObjectURL(zipUrl), 2e3);
      showNotice(`\u7B14\u8BB0\u5DF2\u5BFC\u51FA\uFF08ZIP\uFF0C${decoded.length} \u4E2A\u6587\u4EF6\uFF09`);
    }
    notesRefreshBtn.addEventListener("click", loadAndRenderNotes);
    notesSelectAll.addEventListener("change", () => {
      notesList.querySelectorAll("input.note-check").forEach((el) => {
        el.checked = notesSelectAll.checked;
      });
      updateNoteSelection();
    });
    notesDeleteSelected.addEventListener("click", async () => {
      const ids = getSelectedNoteIds();
      if (ids.length === 0) return;
      try {
        const updated = await deleteNoteDocuments(ids);
        if (!updated) return;
        notes = updated;
        await loadAndRenderNotes();
        showNotice(`\u5DF2\u5220\u9664 ${ids.length} \u7BC7\u7B14\u8BB0`);
      } catch (error) {
        showNotice(`\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${String(error)}`);
      }
    });
    const HISTORY_PAGE_SIZE = 300;
    function formatTime(ts) {
      return new Date(ts).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function getSelectedHistoryIds() {
      return Array.from(historyList.querySelectorAll("input.history-check:checked")).map((el) => el.dataset.id || "").filter(Boolean);
    }
    function updateHistorySelection() {
      const all = Array.from(historyList.querySelectorAll("input.history-check"));
      const selectable = all.filter((el) => !el.disabled);
      const selected = selectable.filter((el) => el.checked);
      historyDeleteSelected.disabled = selected.length === 0;
      historyDeleteSelected.textContent = selected.length > 0 ? `\u5220\u9664\u6240\u9009 (${selected.length})` : "\u5220\u9664\u6240\u9009";
      historySelectAll.checked = selectable.length > 0 && selected.length === selectable.length;
      historySelectAll.indeterminate = selected.length > 0 && selected.length < selectable.length;
      historySelectAll.disabled = selectable.length === 0;
    }
    async function fetchHistoryTranscript(id) {
      const res = await chrome.runtime.sendMessage({
        target: "background",
        type: "GET_HISTORY_TRANSCRIPT",
        id
      });
      if (!res?.ok || !Array.isArray(res.subtitles)) throw new Error(res?.error || "\u6B63\u6587\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      return res.subtitles;
    }
    function appendHistoryRows(container, subtitles, from, to, record) {
      for (let index = from; index < to && index < subtitles.length; index++) {
        const line = subtitles[index];
        container.append(renderEntry({
          ref: { kind: "transcript", recordId: record.id, lineId: line.id },
          sourceRef: line.sourceRef || legacySourceRef(record.url, record.pageTitle, record.id),
          title: record.pageTitle,
          at: line.at || 0,
          videoTime: line.videoTime ?? null,
          source: line.source || "",
          target: line.target || "",
          text: "",
          type: line.kind || "subtitle"
        }, (text) => showNotice(text)));
      }
    }
    function mountHistoryDetail(detail, item) {
      let loaded = false;
      let rows = [];
      let shown = 0;
      const list = document.createElement("div");
      list.className = "history-subtitle-list";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-sm btn-secondary history-more";
      more.hidden = true;
      detail.append(list, more);
      function paintNextBatch() {
        const next = Math.min(rows.length, shown + HISTORY_PAGE_SIZE);
        appendHistoryRows(list, rows, shown, next, item);
        shown = next;
        const remaining = rows.length - shown;
        more.hidden = remaining <= 0;
        more.textContent = `\u663E\u793A\u66F4\u591A\uFF08\u5269\u4F59 ${remaining} \u6761\uFF09`;
      }
      more.addEventListener("click", paintNextBatch);
      return async function ensureLoaded() {
        if (loaded) return;
        detail.textContent = "\u6B63\u5728\u8BFB\u53D6\u2026";
        try {
          rows = await fetchHistoryTranscript(item.id);
        } catch (error) {
          detail.textContent = `\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}\u3002\u6536\u8D77\u540E\u91CD\u65B0\u5C55\u5F00\u53EF\u91CD\u8BD5\u3002`;
          return;
        }
        if (!detail.isConnected) return;
        disposeFavoriteControls(detail);
        detail.textContent = "";
        detail.append(list, more);
        loaded = true;
        if (rows.length === 0) {
          detail.textContent = "\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\u3002";
          return;
        }
        paintNextBatch();
      };
    }
    async function loadAndRenderHistory() {
      let res;
      try {
        res = await chrome.runtime.sendMessage({ target: "background", type: "GET_HISTORY" });
      } catch (error) {
        historyEmpty.style.display = "block";
        historyEmpty.textContent = `\u5386\u53F2\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}\u3002\u8BF7\u5207\u6362\u56DE\u6765\u91CD\u8BD5\u3002`;
        return;
      }
      if (!res?.ok || !Array.isArray(res.history)) {
        historyEmpty.style.display = "block";
        historyEmpty.textContent = `\u5386\u53F2\u8BFB\u53D6\u5931\u8D25\uFF1A${res?.error || "\u8BF7\u5207\u6362\u56DE\u6765\u91CD\u8BD5"}`;
        return;
      }
      await favoriteState().refresh();
      const items = res.history;
      historyEmpty.textContent = "\u8FD8\u6CA1\u6709\u5386\u53F2\u8BB0\u5F55";
      historyCount.textContent = String(items.length);
      disposeFavoriteControls(historyList);
      historyList.textContent = "";
      if (items.length === 0) {
        historyList.style.display = "none";
        historyEmpty.style.display = "block";
        updateHistorySelection();
        return;
      }
      historyList.style.display = "flex";
      historyEmpty.style.display = "none";
      items.forEach((item) => {
        const recording = item.status === "recording";
        const el = document.createElement("div");
        el.className = "history-item";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "history-check";
        check.dataset.id = item.id;
        check.disabled = recording;
        check.title = recording ? "\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u4E0D\u80FD\u5220\u9664" : "";
        check.setAttribute("aria-label", `\u9009\u62E9 ${item.pageTitle || "\u8BB0\u5F55"}`);
        check.addEventListener("change", updateHistorySelection);
        el.appendChild(check);
        const main = document.createElement("div");
        main.className = "history-item-main";
        const title = document.createElement("div");
        title.className = "history-item-title";
        if (item.url) {
          title.classList.add("history-item-link");
          title.setAttribute("role", "link");
          title.tabIndex = 0;
          title.title = `\u6253\u5F00\u539F\u89C6\u9891\uFF1A${item.pageTitle || ""}`;
          const open = async () => {
            try {
              const result = await chrome.runtime.sendMessage({ target: "background", type: "LIBRARY_OPEN_SOURCE", recordId: item.id });
              showNotice(result?.ok ? "\u5DF2\u6253\u5F00\u6765\u6E90\u9875\u9762" : result?.error || "\u6253\u5F00\u6765\u6E90\u5931\u8D25", !result?.ok);
            } catch (error) {
              showNotice(`\u6253\u5F00\u6765\u6E90\u5931\u8D25\uFF1A${String(error)}`, true);
            }
          };
          title.addEventListener("click", open);
          title.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              open();
            }
          });
        } else {
          title.title = item.pageTitle || "";
        }
        title.textContent = item.pageTitle || "\u672A\u77E5\u9875\u9762";
        const meta = document.createElement("div");
        meta.className = "history-item-meta";
        const parts = [
          formatTime(item.startedAt),
          `${item.subtitleCount || 0} \u6761\u5B57\u5E55`,
          `${item.sourceLang || "auto"} \u2192 ${item.targetLang || "zh"}`
        ];
        if (recording) parts.push("\u5F55\u5236\u4E2D");
        meta.textContent = parts.join(" \xB7 ");
        main.append(title, meta);
        el.appendChild(main);
        const detail = document.createElement("div");
        detail.className = "history-item-detail";
        detail.hidden = true;
        el.appendChild(detail);
        const actions = document.createElement("div");
        actions.className = "history-item-actions";
        let ensureDetail = null;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-sm btn-secondary";
        toggle.textContent = "\u67E5\u770B\u5185\u5BB9";
        toggle.addEventListener("click", async () => {
          if (!detail.hidden) {
            detail.hidden = true;
            toggle.textContent = "\u67E5\u770B\u5185\u5BB9";
            return;
          }
          detail.hidden = false;
          toggle.textContent = "\u6536\u8D77\u5185\u5BB9";
          if (!ensureDetail) ensureDetail = mountHistoryDetail(detail, item);
          toggle.disabled = true;
          try {
            await ensureDetail();
          } finally {
            toggle.disabled = false;
          }
        });
        actions.appendChild(toggle);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-sm btn-secondary";
        copy.textContent = "\u590D\u5236";
        copy.addEventListener("click", async () => {
          copy.disabled = true;
          try {
            const rows = await fetchHistoryTranscript(item.id);
            if (rows.length === 0) {
              showNotice("\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\uFF0C\u65E0\u6CD5\u590D\u5236", true);
              return;
            }
            const text = rows.map((subtitle) => `${subtitle.source || ""}
${subtitle.target || ""}`).join("\n\n");
            const ok = await copyText(text);
            showNotice(ok ? "\u5DF2\u590D\u5236\u5B8C\u6574\u8F6C\u5199\u5185\u5BB9" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u526A\u8D34\u677F\u8BBF\u95EE", !ok);
          } catch (error) {
            showNotice(`\u590D\u5236\u5931\u8D25\uFF1A${String(error)}`, true);
          } finally {
            copy.disabled = false;
          }
        });
        actions.appendChild(copy);
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.className = "btn btn-sm btn-secondary";
        exportButton.textContent = "\u5BFC\u51FA Markdown";
        exportButton.addEventListener("click", async () => {
          exportButton.disabled = true;
          try {
            const rows = await fetchHistoryTranscript(item.id);
            if (rows.length === 0) {
              showNotice("\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\uFF0C\u65E0\u6CD5\u5BFC\u51FA", true);
              return;
            }
            const blob = new Blob([historyMarkdown(item, rows)], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `snooper-history-${item.id}.md`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 2e3);
          } catch (error) {
            showNotice(`\u5BFC\u51FA\u5931\u8D25\uFF1A${String(error)}`, true);
          } finally {
            exportButton.disabled = false;
          }
        });
        actions.appendChild(exportButton);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-sm btn-secondary";
        del.textContent = "\u5220\u9664";
        del.disabled = recording;
        del.title = recording ? "\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u4E0D\u80FD\u5220\u9664" : "";
        del.addEventListener("click", async () => {
          try {
            const res2 = await confirmLibraryDelete({ transcriptIds: [item.id] });
            if (!res2) return;
            if (res2.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
            await loadAndRenderHistory();
          } catch (error) {
            showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
          }
        });
        actions.appendChild(del);
        el.appendChild(actions);
        historyList.appendChild(el);
      });
      updateHistorySelection();
    }
    historySelectAll.addEventListener("change", () => {
      const checked = historySelectAll.checked;
      historyList.querySelectorAll("input.history-check:not(:disabled)").forEach((el) => {
        el.checked = checked;
      });
      updateHistorySelection();
    });
    historyDeleteSelected.addEventListener("click", async () => {
      const ids = getSelectedHistoryIds();
      if (ids.length === 0) return;
      try {
        const res = await confirmLibraryDelete({ transcriptIds: ids });
        if (!res) return;
        if (res.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
        await loadAndRenderHistory();
      } catch (error) {
        showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
      }
    });
    historyClear.addEventListener("click", async () => {
      try {
        const history = await chrome.runtime.sendMessage({ target: "background", type: "GET_HISTORY" });
        if (!history?.ok) throw new Error(history?.error || "\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2\u8BB0\u5F55");
        const res = await confirmLibraryDelete({ transcriptIds: history.history.map((item) => item.id) });
        if (!res) return;
        if (res.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
        await loadAndRenderHistory();
      } catch (error) {
        showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
      }
    });
    function historyMarkdown(item, subtitles) {
      const anchored = subtitles.some(
        (subtitle) => typeof subtitle.videoTime === "number" && Number.isFinite(subtitle.videoTime)
      );
      const lines = [
        `# ${item.pageTitle || "\u8F6C\u5199\u5386\u53F2"}`,
        "",
        `- **\u5F00\u59CB**\uFF1A${formatTime(item.startedAt)}`,
        `- **\u7ED3\u675F**\uFF1A${formatTime(item.endedAt ?? item.lastAt)}`,
        `- **\u8BED\u8A00**\uFF1A${item.sourceLang || "auto"} \u2192 ${item.targetLang || "zh"}`,
        `- **\u5B57\u5E55\u6761\u76EE**\uFF1A${subtitles.length} \u6761`,
        "",
        anchored ? "| \u89C6\u9891\u65F6\u95F4 | \u5F55\u5236\u65F6\u95F4 | \u539F\u6587 | \u8BD1\u6587 |" : "| \u65F6\u95F4 | \u539F\u6587 | \u8BD1\u6587 |",
        anchored ? "| :--- | :--- | :--- | :--- |" : "| :--- | :--- | :--- |"
      ];
      for (const subtitle of subtitles) {
        const wall = subtitle.at ? new Date(subtitle.at).toLocaleTimeString("zh-CN") : "";
        const source = (subtitle.source || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        const target = (subtitle.target || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        if (anchored) {
          const hasTime = typeof subtitle.videoTime === "number" && Number.isFinite(subtitle.videoTime);
          const video = hasTime ? formatVideoTime(subtitle.videoTime) : "";
          const link = hasTime && subtitle.sourceRef?.confidence === "exact" ? videoDeepLink(subtitle.sourceRef.url, subtitle.videoTime) : null;
          lines.push(`| ${link ? `[\`${video}\`](${link})` : video} | ${wall} | ${source} | ${target} |`);
        } else {
          lines.push(`| ${wall} | ${source} | ${target} |`);
        }
      }
      return lines.join("\n");
    }
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      }
    }
    async function renderObsidianConfig() {
      obsidianCfg = await loadObsidianConfig();
      obsidianEnabled.checked = obsidianCfg.enabled;
      obsidianProtocol.value = obsidianCfg.apiProtocol;
      obsidianPort.value = String(obsidianCfg.apiPort);
      obsidianFolder.value = obsidianCfg.noteFolder;
      obsidianKey.value = obsidianCfg.apiKey;
      obsidianTestStatus.hidden = true;
    }
    async function syncObsidianForm() {
      obsidianCfg.enabled = obsidianEnabled.checked;
      obsidianCfg.apiProtocol = obsidianProtocol.value === "https" ? "https" : "http";
      obsidianCfg.apiPort = parseInt(obsidianPort.value, 10) || (obsidianCfg.apiProtocol === "https" ? 27124 : 27123);
      obsidianCfg.noteFolder = obsidianFolder.value.trim() || "snooper-notes";
      obsidianCfg.apiKey = obsidianKey.value.trim();
      await saveObsidianConfig(obsidianCfg);
    }
    saveConfigBtn.addEventListener("click", async () => {
      await syncObsidianForm();
      showNotice("Obsidian \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    });
    obsidianTest.addEventListener("click", async () => {
      await syncObsidianForm();
      obsidianTest.disabled = true;
      obsidianTestStatus.textContent = "\u6B63\u5728\u6D4B\u8BD5\u2026";
      obsidianTestStatus.hidden = false;
      obsidianTestStatus.className = "obsidian-test-status";
      try {
        const res = await chrome.runtime.sendMessage({
          target: "background",
          type: "TEST_OBSIDIAN",
          obsidianConfig: obsidianCfg
        });
        if (res && res.ok) {
          obsidianCfg.apiProtocol = res.protocol;
          obsidianCfg.apiPort = res.port;
          await saveObsidianConfig(obsidianCfg);
          obsidianProtocol.value = res.protocol;
          obsidianPort.value = String(res.port);
          obsidianTestStatus.textContent = `\u8FDE\u63A5\u6210\u529F\uFF08${String(res.protocol).toUpperCase()} ${res.port}\uFF09\uFF0C\u5DF2\u4FDD\u5B58`;
          obsidianTestStatus.className = "obsidian-test-status ok";
        } else {
          obsidianTestStatus.textContent = res?.error || "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u4E14 Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528";
          obsidianTestStatus.className = "obsidian-test-status err";
        }
      } catch (err) {
        obsidianTestStatus.textContent = err.message || "\u901A\u4FE1\u5F02\u5E38";
        obsidianTestStatus.className = "obsidian-test-status err";
      } finally {
        obsidianTest.disabled = false;
      }
    });
    obsidianProtocol.addEventListener("change", () => {
      const port = parseInt(obsidianPort.value, 10);
      if (!port || port === 27123 || port === 27124) {
        obsidianPort.value = obsidianProtocol.value === "https" ? "27124" : "27123";
      }
    });
    void renderObsidianConfig();
    library.activate();
    void loadAndRenderNotes();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void loadAndRenderNotes();
        if (document.getElementById("panel-search")?.classList.contains("active")) library.activate();
      }
    });
  })();
})();
