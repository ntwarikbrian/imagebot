(() => {
  const VERSION = 2;
  if (window.__xdownContentLoaded && window.__xdownVersion === VERSION) return;
  window.__xdownContentLoaded = true;
  window.__xdownVersion = VERSION;

  const BADGE_EDGE = 18;
  const overlay = {
    mode: "off",
    links: {},
    root: null,
    badges: new Map(),
    storedDeep: []
  };

  function ensureDom() {
    if (overlay.root && overlay.root.isConnected) return;
    const root = document.createElement("div");
    root.className = "xdown-overlay";
    root.setAttribute("aria-hidden", "true");
    (document.body || document.documentElement).appendChild(root);
    overlay.root = root;

    if (!document.getElementById("xdown-style")) {
      const style = document.createElement("style");
      style.id = "xdown-style";
      style.textContent =
        ".xdown-overlay{position:fixed;inset:0;height:0;width:0;z-index:2147483646;pointer-events:none}" +
        ".xdown-badge{position:fixed;width:18px;height:18px;padding:0;margin:0;border:1px solid rgba(0,0,0,.5);border-radius:3px;" +
        "background:#c26363;color:#fff;font:700 12px/16px sans-serif;text-align:center;cursor:pointer;" +
        "box-shadow:0 1px 3px rgba(0,0,0,.4);pointer-events:auto;z-index:1}" +
        ".xdown-badge.marked{background:#3e8e5a}" +
        ".xdown-badge.unmarked:hover{background:#e0a9a9}";
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function isVisible(video) {
    if (!video || !video.isConnected) return false;
    if (video.closest("[data-xdown-skip]")) return false;
    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = video.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
  }

  function keyFor(video) {
    return video.currentSrc || video.src || "";
  }

  function extFor(url) {
    const m = /\.(mp4|webm|m4v|mov|mkv|ogv|ogg)(?:[?#]|$)/i.exec(url);
    return m ? m[1].toLowerCase() : "mp4";
  }

  function labelFor(video, url) {
    const direct = video.getAttribute("aria-label") || video.title || video.getAttribute("alt");
    if (direct && direct.trim()) return direct.trim();
    const host = video.closest("[aria-label], [title]");
    if (host) {
      const found = host.getAttribute("aria-label") || host.getAttribute("title");
      if (found && found.trim()) return found.trim();
    }
    try {
      const u = new URL(url);
      if (u.protocol !== "blob:" && u.protocol !== "data:") {
        const last = decodeURIComponent((u.pathname.split("/").pop() || "").trim());
        if (last) return last;
      }
      return u.hostname;
    } catch (err) {
      return "Video";
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function urlFor(video) {
    const current = video.currentSrc;
    if (current) return current;
    if (video.src) return video.src;
    if (video.querySelector) {
      const source = video.querySelector("source[src]");
      if (source && source.src) return source.src;
    }
    return "";
  }

  function addVideo(video, out) {
    if (!video || !video.isConnected) return;
    const url = urlFor(video);
    if (!url || !/^(https?:|blob:|data:)/i.test(url)) return;
    if (out.has(url)) return;
    out.set(url, { key: url, url, label: labelFor(video, url), ext: extFor(url) });
  }

  function collectFrom(root, out, seen) {
    if (!root) return;
    if (seen.has(root)) return;
    seen.add(root);
    const videos = root.querySelectorAll ? root.querySelectorAll("video") : [];
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const video of videos) addVideo(video, out);
    for (const el of all) {
      if (el.tagName === "VIDEO") continue;
      if (el.tagName === "SOURCE" && (el.type || "").toLowerCase().startsWith("video")) {
        addVideo(el.parentElement, out);
        continue;
      }
      if (el.shadowRoot) collectFrom(el.shadowRoot, out, seen);
      if (el.tagName === "IFRAME") {
        let doc = null;
        try {
          doc = el.contentDocument;
        } catch (err) {
          doc = null;
        }
        if (doc && doc !== root.ownerDocument) collectFrom(doc, out, seen);
      }
    }
    if (root.shadowRoot) collectFrom(root.shadowRoot, out, seen);
  }

  function fullCollect() {
    const out = new Map();
    collectFrom(document, out, new Set());
    return [...out.values()];
  }

  function mergedCollect() {
    const out = new Map();
    for (const entry of [...fullCollect(), ...overlay.storedDeep]) {
      if (!out.has(entry.key)) out.set(entry.key, entry);
    }
    return [...out.values()];
  }

  async function deepScan() {
    const out = new Map();
    const merge = (list) => {
      for (const entry of list) if (!out.has(entry.key)) out.set(entry.key, entry);
    };
    merge(fullCollect());
    try {
      const docHeight = document.documentElement.scrollHeight || 0;
      const maxScroll = Math.max(docHeight - window.innerHeight, 0);
      const startY = window.scrollY;
      const step = Math.max(Math.max(window.innerHeight, 400) * 0.8, 300);
      const maxSteps = 14;
      let y = 0;
      let steps = 0;
      while (y < maxScroll && steps < maxSteps) {
        window.scrollTo(0, y);
        await sleep(160);
        merge(fullCollect());
        y += step;
        steps++;
      }
      await sleep(300);
      merge(fullCollect());
      try {
        window.scrollTo(0, startY);
      } catch (err) {
        /* restore position if scrolling is restricted */
      }
    } catch (err) {
      /* scrolling unavailable — keep the videos already collected */
    }
    const list = [...out.values()];
    overlay.storedDeep = list;
    return list;
  }

  function findVideoByKey(key) {
    for (const video of document.querySelectorAll("video")) {
      if (keyFor(video) === key) return video;
    }
    return null;
  }

  function animateRender() {
    if (overlay._frame) return;
    overlay._frame = requestAnimationFrame(() => {
      overlay._frame = null;
      render();
    });
  }

  function render() {
    if (overlay.mode === "off") {
      if (overlay.root) overlay.root.hidden = true;
      overlay.badges.clear();
      return;
    }
    ensureDom();
    overlay.root.hidden = false;
    overlay.root.textContent = "";
    overlay.badges.clear();

    for (const video of document.querySelectorAll("video")) {
      if (!isVisible(video)) continue;
      const key = keyFor(video);
      if (!key) continue;
      const marked = Boolean(overlay.links[key]);
      if (overlay.mode === "paused" && !marked) continue;

      const rect = video.getBoundingClientRect();
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "xdown-badge" + (marked ? " marked" : " unmarked");
      badge.textContent = "✓";
      badge.style.left = `${rect.right - BADGE_EDGE - 4}px`;
      badge.style.top = `${rect.top + 4}px`;
      badge.dataset.key = key;
      badge.title = marked ? "Linked — click to unlink" : "Not linked — click to link";
      overlay.root.appendChild(badge);
      overlay.badges.set(video, badge);
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      if (overlay.mode !== "selecting") return;
      const badge = event.target.closest(".xdown-badge");
      const badgeKey = badge ? badge.dataset.key : null;
      const video = badgeKey ? findVideoByKey(badgeKey) : event.target.closest("video");
      if (!video || !isVisible(video)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      const key = keyFor(video);
      if (!key) return;
      chrome.runtime.sendMessage({
        type: "VIDEO_CLICK",
        key,
        url: key,
        label: labelFor(video, key),
        ext: extFor(key)
      });
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "PING") {
      sendResponse({ ok: true, version: VERSION });
      return;
    }
    if (msg.type === "RESET") {
      overlay.mode = "off";
      overlay.links = {};
      overlay.storedDeep = [];
      render();
      chrome.runtime.sendMessage({ type: "VIDEOS", videos: mergedCollect() }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SYNC") {
      overlay.mode = (msg.mode === "selecting" || msg.mode === "paused") ? msg.mode : "off";
      overlay.links = msg.links && typeof msg.links === "object" ? msg.links : {};
      render();
      sendResponse({ ok: true, mode: overlay.mode });
      return;
    }
    if (msg.type === "GET_VIDEOS") {
      sendResponse({ ok: true, videos: mergedCollect() });
      return;
    }
    if (msg.type === "SCAN_SEARCH") {
      deepScan()
        .then((videos) => {
          sendResponse({ ok: true, videos });
          chrome.runtime.sendMessage({ type: "VIDEOS", videos }).catch(() => {});
        })
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true;
    }
    if (msg.type === "DOWNLOAD_ALL") {
      downloadLinked(msg.list || [])
        .then((res) => sendResponse({ ok: true, ...res }))
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true;
    }
  });

  function mimeFor(ext) {
    switch ((ext || "mp4").toLowerCase()) {
      case "webm": return "video/webm";
      case "mkv": return "video/x-matroska";
      case "ogv":
      case "ogg": return "video/ogg";
      case "mov":
      case "m4v": return "video/mp4";
      default: return "video/mp4";
    }
  }

  async function fetchBytes(url) {
    const res = await fetch(url, { credentials: "include", mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) throw new Error("File is empty");
    return buf;
  }

  async function downloadLinked(list) {
    let okCount = 0;
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      try {
        let result;
        if (/^https?:/i.test(item.url)) {
          result = await chrome.runtime.sendMessage({ type: "DOWNLOAD_VIDEO", url: item.url, filename: item.filename });
          if (!result || !result.ok) {
            const buf = await fetchBytes(item.url);
            result = await chrome.runtime.sendMessage({
              type: "DOWNLOAD_BYTES",
              data: buf,
              filename: item.filename,
              mime: mimeFor(item.ext)
            });
          }
        } else if (/^(blob|data):/i.test(item.url)) {
          const buf = await fetchBytes(item.url);
          result = await chrome.runtime.sendMessage({
            type: "DOWNLOAD_BYTES",
            data: buf,
            filename: item.filename,
            mime: mimeFor(item.ext)
          });
        } else {
          throw new Error("Unsupported video source");
        }
        if (!result || !result.ok) throw new Error((result && result.error) || "Download refused");
        okCount++;
      } catch (err) {
        failed.push({ index: item.index, reason: String((err && err.message) || err) });
      }
      chrome.runtime.sendMessage({
        type: "DOWNLOAD_PROGRESS",
        done: okCount + failed.length,
        total: list.length
      }).catch(() => {});
    }
    return { downloaded: okCount, failed, count: list.length };
  }

  let lastSignal = "";
  function tick() {
    const videos = mergedCollect();
    const signal = videos.map((v) => `${v.key}|${v.label}`).join("~~");
    if (signal !== lastSignal) {
      lastSignal = signal;
      chrome.runtime.sendMessage({ type: "VIDEOS", videos }).catch(() => {});
    }
    if (overlay.mode !== "off") animateRender();
  }

  window.addEventListener("scroll", animateRender, { passive: true, capture: true });
  window.addEventListener("resize", animateRender, { passive: true });
  setInterval(tick, 1500);
  setTimeout(tick, 400);
})();