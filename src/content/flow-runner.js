(() => {
  const FLOW_HOST = "flow.google.com";
  const runner = { running: false, stopRequested: false, scenes: [], states: {}, options: {}, message: "Ready", error: false };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (element) => { const r = element?.getBoundingClientRect(); return !!r && r.width > 2 && r.height > 2 && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none"; };
  const textOf = (element) => `${element?.getAttribute("aria-label") || ""} ${element?.getAttribute("title") || ""} ${element?.placeholder || ""} ${element?.innerText || ""}`.toLowerCase();
  const status = () => ({ running: runner.running, states: runner.states, message: runner.message, error: runner.error });
  const report = (message, error = false) => { runner.message = message; runner.error = error; chrome.runtime.sendMessage({ type: "RUN_STATUS", status: status() }).catch(() => {}); };

  const overlay = { mode: "off", links: {}, activeSceneId: null, layer: null, timer: null, elements: new Map() };
  const overlayOnScroll = () => requestAnimationFrame(renderOverlayBadges);
  function injectOverlayStyles() {
    if (!document.getElementById("fsr-overlay-style")) {
      const style = document.createElement("style");
      style.id = "fsr-overlay-style";
      style.textContent = ".fsr-overlay-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646}.fsr-badge{position:fixed;width:18px;height:18px;border:2px solid #4f6df5;background:#4f6df5;border-radius:50%;color:#fff;font:700 10px/1 ui-sans-serif,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;padding:0;cursor:pointer;pointer-events:auto;box-shadow:0 1px 3px rgba(0,0,0,.5)}.fsr-badge.marked{width:auto;min-width:18px;padding:0 6px;border-radius:10px;background:#2f6b3f;border-color:#8be1a3}.fsr-badge.idle{background:rgba(47,107,63,.22);border-color:rgba(139,225,163,.5);color:#d4ffe0;pointer-events:none;cursor:default}";
      (document.head || document.documentElement).appendChild(style);
    }
  }
  function renderOverlayBadges() {
    const layer = overlay.layer;
    if (!layer || overlay.mode === "off") return;
    layer.replaceChildren();
    overlay.elements.clear();
    const markedUrls = new Set(Object.values(overlay.links));
    for (const image of generatedImages()) {
      const url = image.currentSrc || image.src;
      if (!url) continue;
      overlay.elements.set(url, image);
      const marked = markedUrls.has(url);
      if (!marked && overlay.mode === "paused") continue;
      const rect = image.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.right < 0 || rect.bottom < 0 || rect.top > innerHeight || rect.left > innerWidth) continue;
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = `fsr-badge${marked ? " marked" : ""}${overlay.mode === "paused" ? " idle" : ""}`;
      if (marked) {
        const sceneIds = Object.entries(overlay.links).filter(([, linkedUrl]) => linkedUrl === url).map(([id]) => id).sort((a, b) => Number(a) - Number(b));
        const tick = document.createElement("span");
        tick.textContent = "✓";
        const number = document.createElement("span");
        number.textContent = sceneIds.join(",");
        badge.append(tick, number);
      }
      if (overlay.mode === "selecting") badge.addEventListener("click", () => { chrome.runtime.sendMessage({ type: "LINK_CLICK", sceneId: overlay.activeSceneId, url }).catch(() => {}); });
      else badge.style.pointerEvents = "none";
      layer.appendChild(badge);
      badge.style.left = `${Math.max(0, rect.right - badge.offsetWidth - 8)}px`;
      badge.style.top = `${Math.max(0, rect.top + 8)}px`;
    }
  }
  function applyOverlay(message) {
    if (location.hostname !== FLOW_HOST) return;
    overlay.mode = String(message?.mode || "off");
    overlay.links = message?.links && typeof message.links === "object" ? message.links : {};
    overlay.activeSceneId = message?.activeSceneId ?? null;
    if (overlay.mode === "off") { stopOverlay(); return; }
    injectOverlayStyles();
    if (!overlay.layer) {
      overlay.layer = document.createElement("div");
      overlay.layer.className = "fsr-overlay-layer";
      document.documentElement.appendChild(overlay.layer);
    }
    if (!overlay.timer) {
      overlay.timer = setInterval(renderOverlayBadges, 1000);
      window.addEventListener("scroll", overlayOnScroll, true);
      window.addEventListener("resize", renderOverlayBadges);
    }
    renderOverlayBadges();
  }
  function stopOverlay() {
    if (overlay.timer) { clearInterval(overlay.timer); overlay.timer = null; }
    window.removeEventListener("scroll", overlayOnScroll, true);
    window.removeEventListener("resize", renderOverlayBadges);
    overlay.layer?.remove();
    overlay.layer = null;
    overlay.elements.clear();
  }

  function inputScore(element) {
    if (!isVisible(element) || element.disabled || element.readOnly) return -100;
    const hint = textOf(element); let score = 0;
    if (/prompt|describe|imagine|create|generate/.test(hint)) score += 20;
    if (element.matches("textarea")) score += 8;
    if (element.matches("[contenteditable=true]")) score += 6;
    const rect = element.getBoundingClientRect(); if (rect.width > 150) score += 4;
    return score;
  }
  function findPromptInput() {
    return [...document.querySelectorAll("textarea, input[type=text], [contenteditable=true]")]
      .map((element) => ({ element, score: inputScore(element) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }
  function setPrompt(input, prompt) {
    input.focus();
    if (input.matches("[contenteditable=true]")) {
      input.textContent = "";
      document.execCommand("insertText", false, prompt);
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      setter ? setter.call(input, prompt) : (input.value = prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " ", code: "Space" }));
  }
  function buttonScore(button, input) {
    if (!isVisible(button) || button.disabled || button.getAttribute("aria-disabled") === "true") return -100;
    const hint = textOf(button); let score = 0;
    if (/generate|create|send|submit/.test(hint)) score += 30;
    if (/download|delete|share|settings|help/.test(hint)) score -= 50;
    if (input) { const a = button.getBoundingClientRect(), b = input.getBoundingClientRect(); score += Math.max(0, 15 - Math.hypot(a.x - b.right, a.y - b.y) / 55); }
    return score;
  }
  function findGenerateButton(input) {
    return [...document.querySelectorAll("button, [role=button]")]
      .map((element) => ({ element, score: buttonScore(element, input) }))
      .filter(({ score }) => score > -20).sort((a, b) => b.score - a.score)[0]?.element || null;
  }
  function generatedImages() {
    return [...document.images].filter((image) => isVisible(image) && image.naturalWidth >= 128 && image.naturalHeight >= 128 && image.currentSrc && !/logo|avatar|icon/i.test(image.alt || ""));
  }
  async function waitForNewImage(before, timeoutMs = 180000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (runner.stopRequested) throw new Error("Stopped by you");
      const candidates = generatedImages();
      const newest = candidates.filter((image) => !before.has(image.currentSrc)).at(-1);
      if (newest) return newest;
      await delay(900);
    }
    throw new Error("No new image appeared within 3 minutes");
  }
  function extensionFor(url) { if (/\.jpe?g([?#]|$)/i.test(url)) return "jpg"; if (/\.webp([?#]|$)/i.test(url)) return "webp"; return "png"; }
  async function downloadImage(image, index) {
    const url = image.currentSrc || image.src;
    if (/^https?:/i.test(url)) {
      const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_IMAGE", url, filename: `image${String(index).padStart(3, "0")}.${extensionFor(url)}` });
      if (!response?.ok) throw new Error(response?.error || "Download was refused");
      return;
    }
    // Flow may use a temporary blob URL. Its own download control preserves the original image in that case.
    const box = image.closest("article, [role=listitem], [class*=card], [class*=tile]") || image.parentElement;
    const control = [...(box?.querySelectorAll("button, [role=button]") || [])].find((button) => /download/.test(textOf(button)));
    if (!control) throw new Error("The generated image had no downloadable URL or Download button");
    control.click();
  }
  async function generateScene(scene, index) {
    const input = findPromptInput();
    if (!input) throw new Error("I could not find Flow’s prompt box. Click it once, then retry.");
    const before = new Set(generatedImages().map((image) => image.currentSrc));
    setPrompt(input, scene.prompt);
    await delay(450);
    const button = findGenerateButton(input);
    if (!button) throw new Error("I could not find Flow’s Generate arrow. Make sure a model is selected, then retry.");
    if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error("Flow’s Generate arrow is disabled");
    button.click();
    const image = await waitForNewImage(before);
    if (runner.options.download) await downloadImage(image, index);
  }
  async function run() {
    runner.running = true; runner.stopRequested = false;
    for (let index = 0; index < runner.scenes.length; index += 1) {
      const scene = runner.scenes[index];
      if (runner.stopRequested) break;
      let completed = false;
      for (let attempt = 0; attempt <= runner.options.maxRetries && !completed; attempt += 1) {
        runner.states[scene.id] = { state: "running", attempt };
        report(`Scene ${index + 1}/${runner.scenes.length}: generating${attempt ? ` (retry ${attempt}/${runner.options.maxRetries})` : ""}…`);
        try { await generateScene(scene, index + 1); completed = true; runner.states[scene.id] = { state: "done" }; report(`Scene ${index + 1}/${runner.scenes.length} complete.`); }
        catch (error) {
          if (runner.stopRequested) break;
          if (attempt === runner.options.maxRetries) { runner.states[scene.id] = { state: "failed" }; report(`Scene ${index + 1} failed after ${attempt + 1} attempt(s): ${error.message}`, true); }
          else { report(`Scene ${index + 1} did not finish; retrying in 3 seconds…`, true); await delay(3000); }
        }
      }
    }
    runner.running = false;
    const failed = Object.values(runner.states).filter((item) => item.state === "failed").length;
    report(runner.stopRequested ? "Stopped. Completed scenes remain downloaded." : failed ? `Finished with ${failed} scene${failed === 1 ? "" : "s"} needing attention.` : `Finished all ${runner.scenes.length} scenes.` , failed > 0);
  }
  const imageToDataUrl = async (image, url) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return null;
    context.drawImage(image, 0, 0);
    try { return canvas.toDataURL(/\.jpe?g([?#]|$)/i.test(url) ? "image/jpeg" : "image/png", /\.jpe?g([?#]|$)/i.test(url) ? 0.92 : undefined); }
    catch { return null; }
  };
  const fetchToDataUrl = async (url) => {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  };
  const resolveImageData = async (url) => {
    const live = overlay.elements.get(url);
    if (live?.complete && live.naturalWidth > 0) {
      const dataUrl = await imageToDataUrl(live, url);
      if (dataUrl) return { ok: true, dataUrl };
    }
    try {
      const dataUrl = await fetchToDataUrl(url);
      if (dataUrl) return { ok: true, dataUrl };
    } catch { /* fall through */ }
    return { ok: false, error: "Could not read that image from the Flow page." };
  };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "LINK_MODE") { applyOverlay(message); sendResponse({ ok: true }); return; }
    if (message?.type === "GET_STATUS") { sendResponse(status()); return; }
    if (message?.type === "STOP") { runner.stopRequested = true; report("Stopping after the current check…"); sendResponse({ ok: true }); return; }
    if (message?.type === "GET_IMAGE") {
      if (location.hostname !== FLOW_HOST) { sendResponse({ ok: false, error: "Not on flow.google.com." }); return; }
      resolveImageData(String(message.url || "")).then(sendResponse);
      return true;
    }
    if (message?.type === "START") {
      if (location.hostname !== FLOW_HOST) { sendResponse({ ok: false, error: "This runner only works on flow.google.com." }); return; }
      if (runner.running) { sendResponse({ ok: false, error: "A run is already active." }); return; }
      runner.scenes = message.scenes || []; runner.options = { maxRetries: Math.max(0, Math.min(5, Number(message.maxRetries) || 0)), download: message.download !== false }; runner.states = Object.fromEntries(runner.scenes.map((scene) => [scene.id, { state: "pending" }]));
      sendResponse({ ok: true }); run(); return;
    }
  });
})();