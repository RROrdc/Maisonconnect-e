/* Service worker de l'app famille.
   Deux rôles, et deux seulement — on reste volontairement simple, un service worker
   trop malin est la première cause d'« app qui affiche une vieille version » :

   1. La COQUILLE (html, manifeste, icônes) est mise en cache : l'app s'ouvre
      instantanément et même sans réseau.
   2. Les DONNÉES (/api/data) passent par le réseau d'abord, avec le dernier
      contenu connu en repli : au supermarché sans réseau, la liste de courses
      s'affiche quand même (en lecture).

   Ce qui n'est JAMAIS intercepté : /api/flux (c'est un flux permanent, le mettre en
   cache le bloquerait) et toutes les écritures (POST/PATCH/DELETE). */
const VERSION = 'maison-v1';
const COQUILLE = [
  './', './index.html', './manifest.webmanifest',
  './icones/icone-180.png', './icones/icone-192.png', './icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;                       // écritures : jamais touchées
  if (url.pathname === '/api/flux') return;               // flux temps réel : jamais intercepté

  if (url.pathname === '/api/data') {                     // données : réseau d'abord
    e.respondWith(
      fetch(req)
        .then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); return r; })
        .catch(() => caches.match(req).then((r) => r || Response.json({ horsligne: true }, { status: 503 })))
    );
    return;
  }

  if (url.origin !== location.origin) return;             // rien d'extérieur (il n'y en a pas)

  /* coquille : cache d'abord, et on rafraîchit en arrière-plan pour la prochaine ouverture */
  e.respondWith(
    caches.match(req).then((enCache) => {
      const reseau = fetch(req).then((r) => {
        if (r.ok) { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
        return r;
      }).catch(() => enCache);
      return enCache || reseau;
    })
  );
});

/* ── Notifications push ─────────────────────────────────────────────────────
   Ajouté le 13/09, une fois le HTTPS en place. Le service worker est le SEUL
   endroit où une notification peut être affichée quand l'app est fermée —
   c'est même sa raison d'être ici.

   ⚠️ `event.waitUntil` n'est pas une précaution : sans lui, le système peut
   arrêter le service worker avant que la notification soit affichée, et rien
   n'apparaît. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { titre: event.data && event.data.text() }; }
  const titre = d.titre || 'Maison';
  event.waitUntil(self.registration.showNotification(titre, {
    body: d.message || '',
    icon: './icones/icone-192.png',
    badge: './icones/icone-192.png',
    /* Même `tag` = la nouvelle REMPLACE l'ancienne au lieu de s'empiler. Trois
       rappels de devoirs d'affilée, c'est trois fois plus de chances d'être
       ignorés (§ 2 nonies). */
    tag: d.niveau === 'alerte' ? 'maison-alerte' : 'maison',
    renotify: d.niveau === 'alerte',
    data: { url: './' },
  }));
});

/* Toucher la notification doit RAMENER dans l'app déjà ouverte, pas en ouvrir
   une deuxième : se retrouver avec deux exemplaires de la liste de courses est
   le meilleur moyen de cocher dans la mauvaise. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenetres) {
      if (f.url.includes('/app/') && 'focus' in f) return f.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
