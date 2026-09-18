chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const safeName = (filename) => String(filename || "image.png")
  .replace(/[^a-z0-9._-]/gi, "_")
  .replace(/^_+/, "") || "image.png";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_IMAGE") {
    chrome.downloads.download(
      {
        url: message.url,
        filename: `flow-scenes/${safeName(message.filename)}`,
        conflictAction: "uniquify",
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }
  if (message?.type === "DOWNLOAD_BYTES") {
    const blob = new Blob([message.data], { type: message.mime || "image/png" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      {
        url,
        filename: `flow-scenes/${safeName(message.filename)}`,
        conflictAction: "uniquify",
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          URL.revokeObjectURL(url);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }
});