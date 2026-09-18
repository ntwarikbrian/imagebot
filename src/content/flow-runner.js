(() => {
  const FLOW_HOST = "flow.google.com";
  const runner = { running: false, stopRequested: false, scenes: [], states: {}, options: {}, message: "Ready", error: false };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (element) => { const r = element?.getBoundingClientRect(); return !!r && r.width > 2 && r.height > 2 && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none"; };
  const textOf = (element) => `${element?.getAttribute("aria-label") || ""} ${element?.getAttribute("title") || ""} ${element?.placeholder || ""} ${element?.innerText || ""}`.toLowerCase();
  const status = () => ({ running: runner.running, states: runner.states, message: runner.message, error: runner.error });
  const report = (message, error = false) => { runner.message = message; runner.error = error; chrome.runtime.sendMessage({ type: "RUN_STATUS", status: status() }).catch(() => {}); };

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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_STATUS") { sendResponse(status()); return; }
    if (message?.type === "STOP") { runner.stopRequested = true; report("Stopping after the current check…"); sendResponse({ ok: true }); return; }
    if (message?.type === "START") {
      if (location.hostname !== FLOW_HOST) { sendResponse({ ok: false, error: "This runner only works on flow.google.com." }); return; }
      if (runner.running) { sendResponse({ ok: false, error: "A run is already active." }); return; }
      runner.scenes = message.scenes || []; runner.options = { maxRetries: Math.max(0, Math.min(5, Number(message.maxRetries) || 0)), download: message.download !== false }; runner.states = Object.fromEntries(runner.scenes.map((scene) => [scene.id, { state: "pending" }]));
      sendResponse({ ok: true }); run(); return;
    }
  });
})();