const $ = (selector) => document.querySelector(selector);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const elements = {
  timeline: $("#timeline"), split: $("#split"), refresh: $("#refresh"),
  refreshWarning: $("#refresh-warning"), refreshCancel: $("#refresh-cancel"), refreshConfirm: $("#refresh-confirm"),
  link: $("#link"), pause: $("#pause"), downloadAll: $("#download-all"),
  scenes: $("#scenes"), siteStatus: $("#site-status"), runStatus: $("#run-status"),
  previewBackdrop: $("#preview-backdrop"), previewImage: $("#preview-image"), previewClose: $("#preview-close"), previewStatus: $("#preview-status"), inactive: $("#inactive"),
  header: document.querySelector("header"),
  stepPaste: $("#step-paste"), splitting: $("#splitting"), stepScenes: $("#step-scenes"), stepLink: $("#step-link"), backPaste: $("#back-paste")
};
let scenes = [];
let states = {};
let links = {};
let activeSceneId = null;
let linkMode = false;
let paused = false;
let onFlow = false;
let activeTabId = null;
let downloading = false;
const STORAGE_KEY = "flowSceneRunner";
const imageCache = new Map();

function parseTimeline(text) {
  const marker = /\*\*\(([^)]+)\)\*\*\s*/g;
  const hits = [...text.matchAll(marker)];
  return hits.map((hit, index) => ({
    id: index + 1,
    timing: hit[1].trim(),
    prompt: text.slice(hit.index + hit[0].length, hits[index + 1]?.index ?? text.length).trim()
  })).filter((scene) => scene.prompt.length > 0);
}

function renderScenes() {
  const hasScenes = scenes.length > 0;
  elements.stepPaste.hidden = hasScenes;
  elements.stepScenes.hidden = !hasScenes;
  elements.stepLink.hidden = !hasScenes;
  elements.header.hidden = hasScenes;
  elements.runStatus.hidden = hasScenes;
  clearTimeout(setRunStatus.timer);
  elements.scenes.replaceChildren(...scenes.map((scene) => {
    const item = document.createElement("li");
    const linked = Boolean(links[scene.id]);
    const state = linked ? "done" : (states[scene.id]?.state || "pending");
    item.className = scene.id === activeSceneId ? `${state} active` : state;
    item.dataset.id = scene.id;
    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.alt = "Linked image reference";
    const linkedUrl = links[scene.id];
    if (linkedUrl) {
      thumb.classList.add("empty");
      thumb.title = "View linked image";
      thumb.addEventListener("click", () => { showPreview(linkedUrl); });
      const cached = imageCache.get(linkedUrl);
      if (cached) {
        thumb.src = cached;
        thumb.classList.remove("empty");
      } else {
        resolveImage(linkedUrl).then((dataUrl) => {
          if (!dataUrl || !thumb.isConnected) return;
          thumb.src = dataUrl;
          thumb.classList.remove("empty");
        });
      }
      thumb.addEventListener("error", () => { thumb.classList.add("empty"); thumb.removeAttribute("src"); });
    } else {
      thumb.classList.add("empty");
    }
    if (linkMode) {
      const check = document.createElement("button");
      check.type = "button";
      check.className = "check";
      check.setAttribute("aria-label", linked ? "Unlink this scene" : "Choose a reference image for this scene");
      check.setAttribute("aria-pressed", linked);
      check.textContent = linked ? "✓" : "";
      check.addEventListener("click", () => onCircleClick(scene.id));
      item.append(check);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy";
    copy.setAttribute("aria-label", "Copy scene prompt");
    copy.textContent = "⧉";
    copy.addEventListener("click", () => copyPrompt(scene, copy));
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = scene.timing;
    const prompt = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = scene.prompt;
    item.append(thumb, copy, time, prompt);
    item.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target.closest("img")) return;
      activeSceneId = activeSceneId === scene.id ? null : scene.id;
      renderScenes();
      syncOverlay();
    });
    return item;
  }));
}
function onCircleClick(id) {
  if (links[id]) { unlinkScene(id); return; }
  activeSceneId = activeSceneId === id ? null : id;
  renderScenes();
  if (activeSceneId == null) setRunStatus("Link mode on — click a scene’s circle, then click its reference image in Flow.");
  else { const timing = scenes.find((s) => s.id === id)?.timing || id; setRunStatus(`Scene ${id} (${timing}) — click its reference image in Flow.`); }
  syncOverlay();
}
function unlinkScene(id) {
  delete links[id];
  states[id] = { state: "pending" };
  activeSceneId = id;
  saveState();
  renderScenes();
  updateLinkButtons();
  setRunStatus(`Scene ${id} unlinked — pick a new reference image.`);
  syncOverlay();
}
function nextOpenSceneId(fromId) {
  const order = scenes.map((s) => s.id);
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(start + step) % order.length];
    if (!links[id]) return id;
  }
  return null;
}
async function copyPrompt(scene, button) {
  try {
    await navigator.clipboard.writeText(scene.prompt);
    button.textContent = "Copied";
    button.classList.add("copied");
    setTimeout(() => { button.textContent = "⧉"; button.classList.remove("copied"); }, 1200);
  } catch { button.classList.add("copied"); }
}
async function resolveImage(url) {
  if (!url) return null;
  const cached = imageCache.get(url);
  if (cached) return cached;
  const response = await send({ type: "GET_IMAGE", url }).catch(() => null);
  const dataUrl = response?.ok ? response.dataUrl : null;
  if (dataUrl) imageCache.set(url, dataUrl);
  return dataUrl;
}
async function showPreview(url) {
  if (!url) return;
  elements.previewImage.removeAttribute("src");
  elements.previewStatus.hidden = true;
  elements.previewBackdrop.hidden = false;
  const dataUrl = await resolveImage(url);
  if (elements.previewBackdrop.hidden) return;
  if (dataUrl) elements.previewImage.src = dataUrl;
  else elements.previewStatus.hidden = false;
}
function closePreview() {
  elements.previewBackdrop.hidden = true;
  elements.previewImage.removeAttribute("src");
  elements.previewStatus.hidden = true;
}
function setRunStatus(message, error = false) {
  elements.runStatus.textContent = message;
  elements.runStatus.classList.toggle("error", error);
  if (scenes.length && !error) {
    elements.runStatus.hidden = false;
    clearTimeout(setRunStatus.timer);
    setRunStatus.timer = setTimeout(() => { elements.runStatus.hidden = true; }, 4000);
  }
}
async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: {
    timeline: elements.timeline.value,
    scenes,
    states,
    links,
    linkMode,
    paused
  } });
}
async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored[STORAGE_KEY];
  if (!saved) return;
  elements.timeline.value = saved.timeline || "";
  scenes = Array.isArray(saved.scenes) ? saved.scenes : [];
  states = saved.states && typeof saved.states === "object" ? saved.states : {};
  links = saved.links && typeof saved.links === "object" ? saved.links : {};
  linkMode = saved.linkMode === true;
  paused = saved.paused === true;
  if (scenes.length) {
    renderScenes();
    updateLinkButtons();
    setRunStatus(`Restored ${scenes.length} scene${scenes.length === 1 ? "" : "s"} from your last session.`);
  }
}
function send(message) {
  if (activeTabId == null) return Promise.reject(new Error("No active Flow tab."));
  return chrome.tabs.sendMessage(activeTabId, message).catch(async (error) => {
    if (!/Receiving end does not exist|Could not establish connection/.test(error?.message)) throw error;
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content/flow-runner.js"] });
    return chrome.tabs.sendMessage(activeTabId, message);
  });
}
function syncOverlay() {
  if (activeTabId == null) return;
  const mode = linkMode ? "selecting" : (paused || Object.keys(links).length ? "paused" : "off");
  send({ type: "LINK_MODE", mode, links, activeSceneId: linkMode ? activeSceneId : null }).catch(() => {});
}
function updateLinkButtons() {
  elements.link.disabled = !onFlow || linkMode;
  elements.pause.disabled = !onFlow || !linkMode;
  const count = Object.keys(links).length;
  elements.downloadAll.textContent = count ? `Download all (${count})` : "Download all";
  elements.downloadAll.disabled = !onFlow || downloading || count === 0;
}
function updateActiveState() {
  elements.siteStatus.textContent = onFlow ? "Ready on flow.google.com" : "Open flow.google.com";
  elements.siteStatus.className = `status ${onFlow ? "ok" : "bad"}`;
  elements.inactive.hidden = onFlow;
  elements.split.disabled = !onFlow;
  updateLinkButtons();
}

async function checkTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  onFlow = /^https:\/\/flow\.google\.com\//.test(tab?.url || "");
  updateActiveState();
  if (onFlow) syncOverlay();
  if (scenes.length) renderScenes();
}

elements.split.addEventListener("click", async () => {
  elements.refreshWarning.hidden = true;
  elements.split.disabled = true;
  elements.splitting.hidden = false;
  setRunStatus("Splitting scenes…");
  await delay(800);
  const parsed = parseTimeline(elements.timeline.value);
  scenes = parsed;
  states = {};
  links = {};
  activeSceneId = null;
  imageCache.clear();
  elements.splitting.hidden = true;
  elements.split.disabled = false;
  renderScenes();
  setRunStatus(scenes.length ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready for review.` : "No scene markers found. Use **(start–end)** before each prompt.", scenes.length === 0);
  saveState();
  syncOverlay();
});
elements.refresh.addEventListener("click", () => {
  elements.refreshWarning.hidden = false;
  setRunStatus("Confirm you want to clear everything.", true);
});
elements.backPaste.addEventListener("click", () => {
  elements.refreshWarning.hidden = true;
  elements.stepPaste.hidden = false;
  elements.stepScenes.hidden = true;
  elements.stepLink.hidden = true;
  elements.header.hidden = false;
  elements.runStatus.hidden = false;
  setRunStatus("Back to pasting — your scenes and links are saved.");
});
elements.refreshCancel.addEventListener("click", () => {
  elements.refreshWarning.hidden = true;
  setRunStatus("Refreshing cancelled — nothing was cleared.");
});
elements.refreshConfirm.addEventListener("click", async () => {
  scenes = [];
  states = {};
  links = {};
  activeSceneId = null;
  linkMode = false;
  paused = false;
  imageCache.clear();
  elements.timeline.value = "";
  await chrome.storage.local.remove(STORAGE_KEY);
  elements.refreshWarning.hidden = true;
  renderScenes();
  updateLinkButtons();
  setRunStatus("Cleared all saved data. Paste a new timeline.");
  syncOverlay();
});
elements.link.addEventListener("click", () => {
  elements.refreshWarning.hidden = true;
  linkMode = true;
  paused = false;
  updateLinkButtons();
  renderScenes();
  setRunStatus(activeSceneId != null ? `Link mode on — click scene ${activeSceneId}’s reference image in Flow.` : "Link mode on — click a scene’s circle, then click its reference image in Flow.");
  saveState();
  syncOverlay();
});
elements.pause.addEventListener("click", () => {
  elements.refreshWarning.hidden = true;
  linkMode = false;
  paused = true;
  renderScenes();
  updateLinkButtons();
  setRunStatus("Paused — linked images stay marked. Use Link to keep assigning.");
  saveState();
  syncOverlay();
});
elements.downloadAll.addEventListener("click", async () => {
  elements.refreshWarning.hidden = true;
  const targets = scenes.map((scene) => ({ id: scene.id, url: links[scene.id] })).filter((scene) => scene.url);
  if (!targets.length) { setRunStatus("No linked images to download.", true); return; }
  downloading = true;
  updateLinkButtons();
  setRunStatus(`Downloading ${targets.length} linked image${targets.length === 1 ? "" : "s"}…`);
  const response = await send({ type: "DOWNLOAD_ALL", scenes: targets }).catch(() => null);
  downloading = false;
  updateLinkButtons();
  if (!response?.ok) { setRunStatus(response?.error || "Could not download the linked images.", true); return; }
  const saved = response.downloaded ?? 0;
  let status = `Saved ${saved}/${targets.length} linked image${targets.length === 1 ? "" : "s"}.`;
  if (response.failed?.length) status += ` Skipped row${response.failed.length === 1 ? "" : "s"}: ${response.failed.map((item) => `image${item.id}`).join(", ")}.`;
  setRunStatus(status, saved < targets.length);
  if (response.lastDownloadId != null) {
    setTimeout(() => chrome.downloads.show(response.lastDownloadId), 800);
  }
});
elements.previewClose.addEventListener("click", closePreview);
elements.previewBackdrop.addEventListener("click", (event) => { if (event.target === elements.previewBackdrop) closePreview(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.previewBackdrop.hidden) closePreview(); });
elements.timeline.addEventListener("input", saveState);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== activeTabId) return;
  if (message?.type === "DOWNLOAD_PROGRESS") {
    setRunStatus(`Downloading linked images… ${message.done}/${message.total}${message.id != null ? ` (image ${message.id})` : ""}`);
    return;
  }
  if (message?.type !== "LINK_CLICK") return;
  const sceneId = message.sceneId ?? activeSceneId;
  if (sceneId == null || !message.url) return;
  if (links[sceneId] === message.url) { unlinkScene(sceneId); return; }
  links[sceneId] = message.url;
  states[sceneId] = { state: "done" };
  saveState();
  const next = nextOpenSceneId(sceneId);
  activeSceneId = next;
  renderScenes();
  updateLinkButtons();
  if (next == null) setRunStatus("All scenes linked.");
  else { const timing = scenes.find((s) => s.id === next)?.timing || next; setRunStatus(`Scene ${sceneId} linked and marked done. Next: scene ${next} (${timing}).`); }
  syncOverlay();
});
(async () => { await loadState(); checkTab(); })();
chrome.tabs.onActivated.addListener(checkTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTabId || changeInfo.status !== "complete") return;
  onFlow = /^https:\/\/flow\.google\.com\//.test(tab.url || "");
  updateActiveState();
  if (onFlow) syncOverlay();
  if (scenes.length) renderScenes();
});
chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) checkTab(); });