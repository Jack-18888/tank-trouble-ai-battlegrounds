// Keep a background match updating when the browser suspends requestAnimationFrame.
// Browsers may still throttle or suspend the page to save resources.
setInterval(() => self.postMessage(null), 1000 / 60);
