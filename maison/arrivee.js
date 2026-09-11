'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Accueil à l'arrivée — « Bonjour Monsieur » quand quelqu'un rentre.

   Demandé par Rémi (§ 2 vicies). Tout le maillon difficile existait déjà : la
   personnalité majordome sait dire « Monsieur » à lui seul et appeler les
   enfants par leur prénom, le Mac sait synthétiser, le bandeau du bento sait
   réveiller l'écran en veille. Il ne manquait que le détecteur.

   ── LES TROIS GARDE-FOUS, NON NÉGOCIABLES ────────────────────────────────
   1. AUCUN HISTORIQUE. L'état vit en mémoire et meurt avec le serveur. Écrire
      « Enora est rentrée à 17 h 42 » en base fabriquerait un journal de
      présence des enfants — et un journal qui existe finit par se consulter.
      C'est la raison pour laquelle rien ici ne touche à `maison.db`.
   2. ANTI-REBOND. Un iPhone disparaît et réapparaît du réseau sans que
      personne n'ait bougé (veille, changement de borne). On ne salue qu'après
      une VRAIE absence, et jamais la nuit.
   3. UN TÉLÉPHONE N'EST PAS UNE PERSONNE. L'accueil est un bonus. Il ne sert
      jamais de source de vérité — surtout pas pour les couverts, qui restent
      au calendrier (§ 2 terdecies).

   ── POURQUOI LE RÉVEIL mDNS ──────────────────────────────────────────────
   Un iPhone en veille ne répond pas au ping : il paraîtrait parti alors qu'il
   est posé sur la table. On lui envoie donc un datagramme sur le port 5353
   (mDNS), ce qui le réveille assez pour qu'il réponde à l'ARP. C'est l'astuce
   du composant `iphonedetect` de Home Assistant, en cinquante lignes et sans
   Home Assistant.
   ═══════════════════════════════════════════════════════════════════════════ */

const { execFile } = require('child_process');
const dgram = require('dgram');

/* Réglages, tous surchargeables — aucun foyer codé en dur (§ 5 quater). */
const D = {
  intervalle: 45,        // secondes entre deux tours
  absenceMin: 30,        // minutes d'absence avant de saluer à nouveau
  silenceDe: 22,         // on se tait à partir de cette heure
  silenceA: 7,           // et jusqu'à celle-ci
  grace: 3,              // tours manqués tolérés avant de déclarer parti
};

/* état en mémoire, et rien d'autre */
const vus = new Map();   // cle -> { present, absentDepuis, manques }
let minuteur = null;

const maintenant = () => Date.now();

/* « aa:bb:cc:… » sous mille formes : macOS écrit « 0:13:30:2:17:ad », d'autres
   « 00-13-30-02-17-AD ». On compare des chiffres, pas des écritures. */
function normMac(x) {
  const h = String(x || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (h.length < 12) {
    return String(x || '').toLowerCase().split(/[:-]/)
      .map((o) => o.padStart(2, '0')).join(':');
  }
  return h.match(/.{2}/g).join(':');
}

/* Liste « aa:bb:cc:dd:ee:ff|Prénom » par ligne, comme les vacances scolaires. */
function appareils(reglage) {
  return String(reglage || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const [mac, ...reste] = l.split('|');
      return { mac: normMac(mac), qui: reste.join('|').trim() };
    })
    .filter((a) => a.mac.length === 17 && a.qui);
}

function tableArp() {
  return new Promise((resolve) => {
    execFile('/usr/sbin/arp', ['-an'], { timeout: 8000 }, (err, out) => {
      if (err) return resolve(new Map());
      const m = new Map();
      for (const ligne of String(out).split('\n')) {
        const r = ligne.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)/i);
        if (r && !/incomplete/i.test(ligne)) m.set(normMac(r[2]), r[1]);
      }
      resolve(m);
    });
  });
}

/* Un datagramme vide sur le port mDNS. On n'attend aucune réponse : le but est
   seulement de faire sortir le téléphone de sa veille réseau pour qu'il
   réapparaisse dans la table ARP au tour suivant. */
function reveiller(ips) {
  return new Promise((resolve) => {
    let s;
    try { s = dgram.createSocket('udp4'); } catch { return resolve(); }
    let reste = ips.length;
    if (!reste) { try { s.close(); } catch {} return resolve(); }
    const fini = () => { if (--reste <= 0) { try { s.close(); } catch {} resolve(); } };
    for (const ip of ips) {
      try { s.send(Buffer.alloc(1), 5353, ip, () => fini()); }
      catch { fini(); }
    }
    setTimeout(() => { try { s.close(); } catch {} resolve(); }, 1500);
  });
}

function dansLeSilence(de, a) {
  const h = new Date().getHours();
  return de > a ? (h >= de || h < a) : (h >= de && h < a);
}

/* `annoncer(qui)` est fourni par le serveur : ce module ne sait ni parler, ni
   diffuser. Même inversion que `lireDevoirs` dans les rappels — une source qui
   change ne doit pas obliger à réécrire le détecteur. */
async function tour({ reglages = {}, annoncer, journaliser }) {
  const liste = appareils(reglages.arrivee_appareils);
  if (!liste.length) return { suivis: 0 };

  const conf = {
    absenceMin: Number(reglages.arrivee_absence_min) || D.absenceMin,
    silenceDe: Number(reglages.arrivee_silence_de) || D.silenceDe,
    silenceA: Number(reglages.arrivee_silence_a) || D.silenceA,
  };

  /* On réveille les adresses connues AVANT de lire la table : sinon un iPhone
     en veille sort de la liste et l'on annoncerait son « retour » dès qu'il se
     réveille tout seul. */
  const arpAvant = await tableArp();
  const ips = liste.map((a) => arpAvant.get(a.mac)).filter(Boolean);
  if (ips.length) { await reveiller(ips); await new Promise((r) => setTimeout(r, 900)); }
  const arp = await tableArp();

  const arrives = [];
  for (const a of liste) {
    const la = arp.has(a.mac);
    const e = vus.get(a.mac) || { present: false, absentDepuis: 0, manques: 0 };

    if (la) {
      e.manques = 0;
      if (!e.present) {
        const absence = e.absentDepuis ? (maintenant() - e.absentDepuis) / 60000 : Infinity;
        e.present = true;
        /* Au tout premier tour, `absentDepuis` vaut 0 donc l'absence est
           infinie : sans ce garde-fou, un redémarrage du serveur saluerait
           tout le monde d'un coup. */
        const amorcage = !e.absentDepuis;
        if (!amorcage && absence >= conf.absenceMin && !dansLeSilence(conf.silenceDe, conf.silenceA)) {
          arrives.push(a.qui);
        }
      }
    } else if (e.present) {
      /* Tolérance : un tour manqué n'est pas un départ. */
      if (++e.manques >= D.grace) { e.present = false; e.absentDepuis = maintenant(); }
    }
    vus.set(a.mac, e);
  }

  if (arrives.length && typeof annoncer === 'function') {
    try { await annoncer([...new Set(arrives)]); }
    catch (err) { if (journaliser) journaliser('erreur', 'arrivee', err.message); }
  }
  return { suivis: liste.length, presents: [...vus.values()].filter((e) => e.present).length, arrives };
}

function demarrer(options = {}) {
  arreter();
  const tic = () => tour(options).catch(() => { /* déjà journalisé */ });
  const sec = Number((options.reglages || {}).arrivee_intervalle) || D.intervalle;
  minuteur = setInterval(tic, Math.max(20, sec) * 1000);
  tic();
}
function arreter() { if (minuteur) clearInterval(minuteur); minuteur = null; }

/* Pour l'écran de réglages : qui est vu, sans aucune date — on montre un état,
   jamais un historique. */
const etat = () => [...vus.entries()].map(([mac, e]) => ({ mac, present: e.present }));

module.exports = { demarrer, arreter, tour, etat, appareils, normMac, tableArp, D };
