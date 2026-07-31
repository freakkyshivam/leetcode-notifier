self.addEventListener("push", (event) => {
  let data = { title: "LeetCode reminder", body: "You haven't solved anything today." };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // fall back to default text above
  }

  const options = {
    body: data.body,
    icon: "/icon.png",
    badge: "/icon.png",
    requireInteraction: data.isFinalBoss || false,
    vibrate: data.isFinalBoss ? [300, 100, 300, 100, 300] : [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
