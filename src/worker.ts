// Noor Quran – Wake Worker
// Runs on a separate thread. Sends a 'ping' message to the main thread
// every 3 seconds. The main thread uses this to detect when it has been
// woken up after a notification-induced suspension.
let seq = 0
setInterval(() => {
  postMessage({ type: 'ping', seq: seq++ })
}, 3000)
