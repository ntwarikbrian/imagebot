chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "DOWNLOAD_IMAGE") return;

  const safeName = String(message.filename || "image.png")
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/^_+/, "") || "image.png";

  chrome.downloads.download(
    {
      url: message.url,
      filename: `flow-scenes/${safeName}`,
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
});