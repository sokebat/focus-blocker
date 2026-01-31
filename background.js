// PureFocus Service Worker
// Currently all logic is handled by content scripts and popup settings.

chrome.runtime.onInstalled.addListener(() => {
  console.log("PureFocus Extension Installed");
});
