// Service worker: rende l'app installabile e mostra le notifiche push. Nessuna cache: i dati restano sempre quelli del server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let msg = { title: "Second Brain", body: "" };
  try { msg = { ...msg, ...e.data.json() }; } catch { if (e.data) msg.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    tag: msg.tag,
    renotify: !!msg.tag,
    requireInteraction: !!msg.sticky,
    actions: msg.actions || [],
    data: { url: msg.url || "/", taskId: msg.taskId },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url: path, taskId } = e.notification.data || {};
  // Pulsanti del promemoria: agiscono sull'attività senza aprire l'app.
  if (taskId && (e.action === "done" || e.action === "snooze")) {
    e.waitUntil(fetch("/api/task-action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, action: e.action }),
    }).catch(() => {}));
    return;
  }
  // Tocco sulla notifica: riusa una finestra dell'app già aperta, altrimenti ne apre una.
  const url = new URL(path || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.location.origin));
    if (win) { await win.focus(); return win.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
