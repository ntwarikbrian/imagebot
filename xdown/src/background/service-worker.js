let lastDownloadId = null;

function safeName(name) {
  let n = String(name || "").trim().replace(/\\/g, "/");
  const idx = n.lastIndexOf("/");
  if (idx >= 0) n = n.slice(idx + 1);
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return n.slice(0, 200) || "video.mp4";
}

function startDownload(options) {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.download(options, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    } catch (err) {
      reject(err);
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn("sidePanel behavior:", err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "DOWNLOAD_VIDEO") {
    const filename = `xdown/${safeName(msg.filename)}`;
    startDownload({ url: msg.url, filename, conflictAction: "uniquify" })
      .then((id) => {
        lastDownloadId = id;
        sendResponse({ ok: true, downloadId: id });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (msg.type === "DOWNLOAD_BYTES") {
    const blob = new Blob([msg.data], { type: msg.mime || "video/mp4" });
    const url = URL.createObjectURL(blob);
    const filename = `xdown/${safeName(msg.filename)}`;
    startDownload({ url, filename, conflictAction: "uniquify" })
      .then((id) => {
        lastDownloadId = id;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        sendResponse({ ok: true, downloadId: id });
      })
      .catch((err) => {
        URL.revokeObjectURL(url);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
    return true;
  }

  if (msg.type === "REVEAL") {
    if (lastDownloadId != null) {
      chrome.downloads.show(lastDownloadId);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
    return;
  }
});