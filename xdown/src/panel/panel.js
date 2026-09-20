"use strict";

const $ = (id) => document.getElementById(id);
const elements = {
  siteChip: $("site-chip"),
  runStatus: $("run-status"),
  listSub: $("list-sub"),
  searchBtn: $("search-btn"),
  linkBtn: $("link-btn"),
  pauseBtn: $("pause-btn"),
  downloadAll: $("download-all"),
  videos: $("videos"),
  empty: $("empty")
};

const STORE_KEYS = { links: "xdl_links", mode: "xdl_mode", paused: "xdl_paused" };

let activeTabId = null;
let tabHost = "";
let videos = [];
let links = {};
let linkMode = false;
let paused = false;
let downloading = false;

let statusTimer = null;

async function toContent(message) {
  if (activeTabId == null) return undefined;
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch (err) {
    return undefined;
  }
}

async function ensureContent() {
  if (activeTabId == null) return false;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "PING" });
    return true;
  } catch (err) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content/xdown.js"] });
      sync();
      return true;
    } catch (err2) {
      return false;
    }
  }
}

function linkedCount() {
  return videos.filter((v) => links[v.key]).length;
}

function currentMode() {
  if (linkMode) return "selecting";
  if (paused || Object.keys(links).length > 0) return "paused";
  return "off";
}

function sync() {
  toContent({ type: "SYNC", mode: currentMode(), links }).catch(() => {});
}

function saveState() {
  chrome.storage.local.set({
    [STORE_KEYS.links]: links,
    [STORE_KEYS.mode]: linkMode,
    [STORE_KEYS.paused]: paused
  });
}

function loadState() {
  chrome.storage.local.get(Object.values(STORE_KEYS), (s) => {
    links = s[STORE_KEYS.links] || {};
    linkMode = !!s[STORE_KEYS.mode];
    paused = !!s[STORE_KEYS.paused];
    render();
    sync();
  });
}

function setRunStatus(text, persistMs) {
  clearTimeout(statusTimer);
  if (!text) {
    elements.runStatus.hidden = true;
    elements.runStatus.textContent = "";
    return;
  }
  elements.runStatus.hidden = false;
  elements.runStatus.textContent = text;
  if (persistMs) statusTimer = setTimeout(() => setRunStatus(""), persistMs);
}

function makeTarget(video, index) {
  return {
    key: video.key,
    url: video.url,
    label: video.label,
    ext: video.ext,
    filename: `video${index + 1}.${video.ext}`,
    index
  };
}

function render() {
  const linked = linkedCount();
  const countLabel = videos.length
    ? `${linked}/${videos.length} linked · ${videos.length - linked} remaining`
    : "0/0 linked · 0 remaining";
  elements.listSub.textContent = videos.length
    ? `${videos.length} found · ${countLabel}`
    : "No videos found";

  elements.linkBtn.textContent = linkMode ? "Linking… click videos" : "Link videos on the page";
  elements.linkBtn.classList.toggle("active", linkMode);
  elements.linkBtn.disabled = downloading || videos.length === 0;

  elements.searchBtn.disabled = downloading;

  elements.pauseBtn.textContent = paused ? "Paused" : "Pause";
  elements.pauseBtn.classList.toggle("active", paused);
  elements.pauseBtn.disabled = downloading || videos.length === 0 || (!paused && linked === 0);

  elements.downloadAll.textContent = `Download all${linked ? ` (${linked})` : ""}`;
  elements.downloadAll.disabled = linked === 0 || downloading;

  elements.videos.hidden = !videos.length;
  elements.empty.hidden = videos.length > 0;
  elements.videos.textContent = "";

  videos.forEach((video, i) => {
    const isLinked = Boolean(links[video.key]);
    const li = document.createElement("li");
    li.className = isLinked ? "linked" : "";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "row-toggle" + (isLinked ? " linked" : "");
    toggle.textContent = isLinked ? "✓" : "○";
    toggle.title = isLinked ? "Unlink this video" : "Link this video";
    toggle.disabled = downloading;
    toggle.addEventListener("click", () => toggleLink(video));

    const num = document.createElement("span");
    num.className = "row-num";
    num.textContent = String(i + 1);

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = video.label || video.url;
    label.title = video.url;

    const download = document.createElement("button");
    download.type = "button";
    download.className = "row-dl";
    download.textContent = "Download";
    download.disabled = downloading;
    download.addEventListener("click", () => downloadOne(video));

    li.append(toggle, num, label, download);
    elements.videos.appendChild(li);
  });
}

function toggleLink(video) {
  if (downloading) return;
  const key = video.key;
  if (links[key]) delete links[key];
  else links[key] = { url: video.url, label: video.label, ext: video.ext };
  saveState();
  render();
  sync();
}

async function downloadOne(video) {
  if (downloading) return;
  const index = videos.indexOf(video);
  if (index < 0) return;
  await runDownload([video], [makeTarget(video, index)]);
}

async function downloadAll() {
  if (downloading) return;
  const targets = videos.map((v, i) => ({ v, target: makeTarget(v, i) })).filter((t) => links[t.v.key]);
  if (!targets.length) return;
  await runDownload(targets.map((t) => t.v), targets.map((t) => t.target));
}

async function runDownload(sourceVideos, targets) {
  downloading = true;
  setRunStatus("Preparing download…");
  render();
  const res = await toContent({ type: "DOWNLOAD_ALL", list: targets });
  downloading = false;
  setRunStatus("");
  render();

  if (res && res.ok) {
    const { downloaded, failed, count } = res;
    if (!count) {
      setRunStatus("Nothing to download yet — link a video first.");
    } else if (failed && failed.length) {
      const reasons = failed.map((f) => `#${f.index + 1} ${f.reason}`).join(" · ");
      setRunStatus(`Saved ${downloaded} of ${count}. Failed: ${reasons}`, 8000);
    } else {
      setRunStatus(`Saved ${downloaded} to Downloads/xdown.`, 6000);
      chrome.runtime.sendMessage({ type: "REVEAL" }).catch(() => {});
    }
  } else {
    setRunStatus("Download failed — reload the page and try again.", 6000);
  }
}

function pickHost(url) {
  try {
    return new URL(url).hostname || "No page";
  } catch (err) {
    return "No page";
  }
}

async function initTab(tab, quiet) {
  const isHttp = tab.url && /^https?:/i.test(tab.url);
  activeTabId = isHttp ? tab.id : null;
  tabHost = isHttp ? pickHost(tab.url) : "No page";
  elements.siteChip.textContent = tabHost;
  if (activeTabId == null) {
    videos = [];
    render();
    return;
  }
  if (!(await ensureContent())) {
    if (!quiet) setRunStatus("Cannot reach this page — it may be blocked.");
    videos = [];
    render();
    return;
  }
  const res = await toContent({ type: "GET_VIDEOS" });
  const incoming = res && res.ok ? res.videos || [] : [];
  if (!Array.isArray(incoming)) {
    videos = [];
  } else {
    const seen = new Set();
    videos = [];
    for (const v of incoming) {
      if (!v || !v.key || seen.has(v.key)) continue;
      seen.add(v.key);
      videos.push({ key: v.key, url: v.url || v.key, label: v.label || v.key, ext: v.ext || "mp4" });
    }
  }
  sync();
  render();
}

async function refresh() {
  if (activeTabId == null) return;
  let res = await toContent({ type: "GET_VIDEOS" });
  if (res === undefined && (await ensureContent())) {
    res = await toContent({ type: "GET_VIDEOS" });
  }
  if (res && res.ok && Array.isArray(res.videos)) {
    videos = [...res.videos];
    render();
  }
}

async function discover() {
  if (activeTabId == null) {
    setRunStatus("Open a page with videos first.", 4000);
    return;
  }
  setRunStatus("Searching this page for videos…");
  let res = await toContent({ type: "SCAN_SEARCH" });
  if (res === undefined && (await ensureContent())) {
    res = await toContent({ type: "SCAN_SEARCH" });
  }
  if (res && res.ok && Array.isArray(res.videos)) {
    videos = [...res.videos];
    render();
    const label = videos.length === 1 ? "video" : "videos";
    setRunStatus(videos.length ? `Found ${videos.length} ${label} on this page.` : "No videos found on this page.", 5000);
  } else {
    setRunStatus((res && res.error) || "Could not scan this page.", 5000);
  }
}

function boot() {
  elements.searchBtn.addEventListener("click", discover);

  elements.linkBtn.addEventListener("click", () => {
    if (linkMode) {
      linkMode = false;
      paused = true;
    } else {
      linkMode = true;
      paused = false;
    }
    saveState();
    render();
    sync();
  });

  elements.pauseBtn.addEventListener("click", () => {
    paused = !paused;
    linkMode = false;
    saveState();
    render();
    sync();
  });

  elements.downloadAll.addEventListener("click", downloadAll);

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || typeof msg.type !== "string") return;
    if (sender.tab && sender.tab.id !== activeTabId) return;

    if (msg.type === "VIDEOS") {
      if (Array.isArray(msg.videos)) {
        videos = [...msg.videos];
        render();
      }
      return;
    }

    if (msg.type === "VIDEO_CLICK") {
      const existing = videos.find((v) => v.key === msg.key);
      toggleLink(existing || { key: msg.key, url: msg.url, label: msg.label, ext: msg.ext });
      return;
    }

    if (msg.type === "DOWNLOAD_PROGRESS") {
      const { done, total } = msg;
      if (done === 0) setRunStatus("Preparing download…");
      else setRunStatus(`Downloading… ${done}/${total} saved`);
      return;
    }
  });

  chrome.tabs.onActivated.addListener((info) => {
    chrome.tabs.get(info.tabId, (tab) => initTab(tab));
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === "complete") initTab(tab);
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (tabs && tabs[0]) initTab(tabs[0]);
    });
  });

  setInterval(refresh, 2500);

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (tabs && tabs[0]) initTab(tabs[0], true);
  });
  loadState();
}

boot();