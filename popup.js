document.addEventListener("DOMContentLoaded", () => {
  const options = [
    "fb_feed",
    "fb_reels",
    "fb_marketplace",
    "yt_shorts",
    "yt_recommended",
    "ig_reels",
  ];

  // Load saved settings
  chrome.storage.sync.get(options, (result) => {
    options.forEach((option) => {
      const element = document.getElementById(option);
      if (element) {
        // Default to false if not set, except maybe some defaults?
        // Let's default to false for now so user explicitly enables them.
        element.checked = result[option] || false;
      }
    });
  });

  // Save settings on change
  options.forEach((option) => {
    const element = document.getElementById(option);
    if (element) {
      element.addEventListener("change", () => {
        chrome.storage.sync.set({ [option]: element.checked }, () => {
          console.log(`Setting ${option} saved: ${element.checked}`);

          // Optionally notify content script if needed,
          // but content script will check storage on load/navigation.
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs
                .sendMessage(tabs[0].id, {
                  type: "SETTINGS_CHANGED",
                  settings: { [option]: element.checked },
                })
                .catch((err) => {
                  // Ignore error if content script not loaded
                  console.log("Content script not active on this tab");
                });
            }
          });
        });
      });
    }
  });
});
