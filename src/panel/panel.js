const $ = (selector) => document.querySelector(selector);
const elements = {
  timeline: $("#timeline"), split: $("#split"), link: $("#link"), pause: $("#pause"),
  scenes: $("#scenes"), siteStatus: $("#site-status"), runStatus: $("#run-status")
};
let scenes = [];
let states = {};
let links = {};
let activeSceneId = null;
let linkMode = false;
let paused = false;
let onFlow = false;
let activeTabId = null;
const STORAGE_KEY = "flowSceneRunner";

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
  elements.scenes.replaceChildren(...scenes.map((scene) => {
    const item = document.createElement("li");
    const state = states[scene.id]?.state || "pending";
    item.className = scene.id === activeSceneId ? `${state} active` : state;
    item.dataset.id = scene.id;
    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.setAttribute("aria-label", state === "done" ? "Mark scene pending" : "Mark scene done");
    check.setAttribute("aria-pressed", state === "done");
    check.textContent = "✓";
    check.addEventListener("click", () => toggleDone(scene.id));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy";
    copy.setAttribute("aria-label", "Copy scene prompt");
    copy.textContent = "⧉";
    copy.addEventListener("click", () => copyPrompt(scene, copy));
    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.alt = "Linked image";
    if (links[scene.id]) {
      thumb.src = links[scene.id];
      thumb.addEventListener("error", () => thumb.remove());
    } else {
      thumb.style.display = "none";
    }
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = scene.timing;
    item.append(check, copy, thumb, time, document.createTextNode(scene.prompt));
    item.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target.closest("img")) return;
      activeSceneId = activeSceneId === scene.id ? null : scene.id;
      renderScenes();
      syncOverlay();
    });
    return item;
  }));
}
function toggleDone(id) {
  states[id] = states[id]?.state === "done" ? { state: "pending" } : { state: "done" };
  renderScenes();
  saveState();
}
async function copyPrompt(scene, button) {
  try {
    await navigator.clipboard.writeText(scene.prompt);
    button.textContent = "Copied";
    button.classList.add("copied");
    setTimeout(() => { button.textContent = "⧉"; button.classList.remove("copied"); }, 1200);
  } catch { button.classList.add("copied"); }
}
function setRunStatus(message, error = false) { elements.runStatus.textContent = message; elements.runStatus.classList.toggle("error", error); }
async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: {
    timeline: elements.timeline.value,
    scenes,
    states,
    links
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
  if (scenes.length) {
    renderScenes();
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
}

async function checkTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  onFlow = /^https:\/\/flow\.google\.com\//.test(tab?.url || "");
  elements.siteStatus.textContent = onFlow ? "Ready on flow.google.com" : "Open flow.google.com first";
  elements.siteStatus.className = `status ${onFlow ? "ok" : "bad"}`;
  elements.split.disabled = !onFlow;
  updateLinkButtons();
  syncOverlay();
}

elements.split.addEventListener("click", () => {
  scenes = parseTimeline(elements.timeline.value);
  states = {};
  links = {};
  activeSceneId = null;
  renderScenes();
  setRunStatus(scenes.length ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready for review.` : "No scene markers found. Use **(start–end)** before each prompt.", scenes.length === 0);
  saveState();
  syncOverlay();
});
elements.link.addEventListener("click", () => {
  linkMode = true;
  paused = false;
  updateLinkButtons();
  setRunStatus(activeSceneId != null ? `Link mode on — click ${scenes.find((s) => s.id === activeSceneId)?.timing || activeSceneId}’s image in Flow.` : "Link mode on — click a scene first, then click its image in Flow.");
  syncOverlay();
});
elements.pause.addEventListener("click", () => {
  linkMode = false;
  paused = true;
  renderScenes();
  updateLinkButtons();
  setRunStatus("Paused — linked images stay marked. Use Link to keep assigning.");
  syncOverlay();
});
elements.timeline.addEventListener("input", saveState);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== activeTabId || message?.type !== "LINK_CLICK") return;
  const sceneId = message.sceneId ?? activeSceneId;
  if (sceneId == null || !message.url) return;
  if (links[sceneId] === message.url) { delete links[sceneId]; setRunStatus(`Unlinked scene ${sceneId}.`); }
  else { links[sceneId] = message.url; setRunStatus(`Scene ${sceneId} linked.`); }
  saveState();
  renderScenes();
  syncOverlay();
});
(async () => { await loadState(); checkTab(); })();
chrome.tabs.onActivated.addListener(checkTab);
chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) checkTab(); });