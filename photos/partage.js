'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Albums partagés iCloud — lecture d'un album publié.

   ── POURQUOI PAS Photos.app ──────────────────────────────────────────────
   Le Mac porte bien une photothèque de 14 Go, mais :
     · les photos des albums PARTAGÉS n'y sont pas téléchargées (vérifié :
       `scopes/cloudsharing` pèse 24 Ko, aucun fichier image) ;
     · piloter Photos.app exige une session ouverte et une autorisation
       d'automatisation — or le serveur tourne en LaunchDaemon, sans session.
       Un simple appel de test depuis SSH a bloqué deux minutes et lancé l'app.
       C'est le piège déjà payé avec Music (§ 2 untricies), en pire.
   ⇒ Après une coupure de courant, la veille n'aurait plus de photos et
   personne ne saurait pourquoi. Écarté.

   ── CE QU'ON FAIT À LA PLACE ─────────────────────────────────────────────
   Un album partagé peut publier un « site web public ». Derrière cette page,
   iCloud expose la liste des photos en JSON. Aucun identifiant Apple n'est
   stocké, aucune autorisation système n'est demandée, et ça survit à un
   redémarrage sans session.
   ⚠️ Non officielle, comme EcoleDirecte — le projet l'assume déjà. Le jour où
   ça casse, la veille retombe sur l'horloge et les widgets : rien d'autre ne
   dépend d'ici.

   🔑 C'est RÉMI qui choisit ce qui est publié, album par album. Sur un écran
   de cuisine que les invités voient, le garde-fou doit être entre ses mains,
   pas dans une règle que j'aurais écrite à sa place.
   ═══════════════════════════════════════════════════════════════════════════ */

const HOTE = (n) => `https://p${String(n).padStart(2, '0')}-sharedstreams.icloud.com`;
const ORIGINE = 'https://www.icloud.com';

/* Le jeton est ce qui suit le `#` dans le lien de partage. On accepte le lien
   entier ou le jeton seul : personne ne doit avoir à découper une URL à la
   main pour se servir de l'outil. */
function jetonDe(lien) {
  const s = String(lien || '').trim();
  if (!s) return '';
  const d = s.indexOf('#');
  return (d >= 0 ? s.slice(d + 1) : s).replace(/[?/].*$/, '').trim();
}

/* iCloud répartit les albums sur des partitions numérotées. On ne peut pas
   deviner laquelle : le serveur répond 330 avec le bon hôte dans le corps.
   On suit la redirection une fois — pas davantage, une boucle de redirections
   sur un service tiers finirait par ressembler à un déni de service. */
async function appeler(jeton, chemin, corps, partition = 1, essai = 0) {
  const r = await fetch(`${HOTE(partition)}/${jeton}/sharedstreams/${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: ORIGINE, Referer: ORIGINE + '/' },
    body: JSON.stringify(corps || {}),
  });

  if (r.status === 330 && essai === 0) {
    const d = await r.json().catch(() => ({}));
    const hote = d['X-Apple-MMe-Host'] || d.hôte || '';
    const m = String(hote).match(/^p(\d+)-/);
    if (m) return appeler(jeton, chemin, corps, Number(m[1]), 1);
  }
  if (r.status === 400 || r.status === 404) {
    throw new Error('Album introuvable — le lien public est-il bien activé ?');
  }
  if (!r.ok) throw new Error(`iCloud a répondu ${r.status}`);
  return r.json();
}

/* ── La liste des photos ───────────────────────────────────────────────────
   Chaque photo porte plusieurs « dérivées » (tailles). On garde la PLUS
   GRANDE : c'est nous qui redimensionnerons, une seule fois, à la taille de la
   dalle — mieux vaut partir d'une bonne source que d'agrandir une vignette. */
async function lister(lien) {
  const jeton = jetonDe(lien);
  if (!jeton) throw new Error('Lien de partage vide.');

  const d = await appeler(jeton, 'webstream', { streamCtag: null });
  const photos = [];

  for (const p of d.photos || []) {
    const tailles = Object.values(p.derivatives || {})
      .filter((x) => x && x.checksum)
      .sort((a, b) => Number(b.fileSize || 0) - Number(a.fileSize || 0));
    if (!tailles.length) continue;
    /* Les vidéos d'un album partagé ne nous servent pas : la veille affiche des
       images fixes, et une vidéo pèse cent fois plus pour rien. */
    if (String(p.mediaAssetType || '') === 'video') continue;
    photos.push({
      guid: p.photoGuid,
      checksum: tailles[0].checksum,
      octets: Number(tailles[0].fileSize || 0),
      largeur: Number(tailles[0].width || 0),
      hauteur: Number(tailles[0].height || 0),
      legende: String(p.caption || '').trim(),
      /* La date de prise de vue, quand elle est là : elle permettra d'afficher
         « Rhodes, août 2026 » sous la photo plutôt qu'un nom de fichier. */
      date: p.dateCreated || p.batchDateCreated || '',
    });
  }

  return { titre: String(d.streamName || '').trim(), jeton, photos };
}

/* ── Les adresses de téléchargement ────────────────────────────────────────
   Elles sont SIGNÉES et expirent (environ une heure) : on ne les enregistre
   jamais, on les redemande au moment de télécharger. Les garder en base
   fabriquerait des liens morts qu'on croirait valides.
   On demande par paquets : un album de 800 photos en une seule requête se fait
   refuser, et une requête par photo serait huit cents allers-retours. */
async function adresses(jeton, guids, paquet = 25) {
  const out = new Map();
  for (let i = 0; i < guids.length; i += paquet) {
    const lot = guids.slice(i, i + paquet);
    const d = await appeler(jeton, 'webasseturls', { photoGuids: lot });
    for (const [somme, it] of Object.entries(d.items || {})) {
      if (!it || !it.url_location || !it.url_path) continue;
      out.set(somme, `https://${it.url_location}${it.url_path}`);
    }
  }
  return out;
}

module.exports = { lister, adresses, jetonDe };
