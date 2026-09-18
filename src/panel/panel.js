const $ = (selector) => document.querySelector(selector);
const elements = {
  timeline: $("#timeline"), split: $("#split"), scenes: $("#scenes"),
  siteStatus: $("#site-status"), runStatus: $("#run-status")
};
let scenes = [];
let states = {};
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
    item.className = state;
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
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = scene.timing;
    item.append(check, copy, time, document.createTextNode(scene.prompt));
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
    states
  } });
}
async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored[STORAGE_KEY];
  if (!saved) return;
  elements.timeline.value = saved.timeline || "";
  scenes = Array.isArray(saved.scenes) ? saved.scenes : [];
  states = saved.states && typeof saved.states === "object" ? saved.states : {};
  if (scenes.length) {
    renderScenes();
    setRunStatus(`Restored ${scenes.length} scene${scenes.length === 1 ? "" : "s"} from your last session.`);
  }
}

async function checkTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const correct = /^https:\/\/flow\.google\.com\//.test(tab?.url || "");
  elements.siteStatus.textContent = correct ? "Ready on flow.google.com" : "Open flow.google.com first";
  elements.siteStatus.className = `status ${correct ? "ok" : "bad"}`;
  elements.split.disabled = !correct;
}

elements.split.addEventListener("click", () => {
  scenes = parseTimeline(elements.timeline.value);
  states = {};
  renderScenes();
  setRunStatus(scenes.length ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready for review.` : "No scene markers found. Use **(start–end)** before each prompt.", scenes.length === 0);
  saveState();
});
elements.timeline.addEventListener("input", saveState);
(async () => { await loadState(); checkTab(); })();
chrome.tabs.onActivated.addListener(checkTab);
chrome.windows.onFocusChanged.addListener((windowId) => { if (windowId !== chrome.windows.WINDOW_ID_NONE) checkTab(); });