'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Musique — pilotage de Music.app et des enceintes AirPlay, sur le Mac mini.

   Pourquoi AppleScript et pas une API : la musique de la maison passe par
   Music.app, qui est le seul à connaître la bibliothèque, les abonnements et les
   enceintes AirPlay appairées. Aucune API réseau ne donne ça. AppleScript est le
   canal officiel d'Apple pour le piloter, il ne demande aucune clé et il ne sort
   pas de la machine.

   ⚠️ Ce fichier ne fonctionne QUE sur macOS. C'est la règle du projet
   (§ 2 septies) : « un adaptateur qu'on ne peut pas exécuter, ce sont des bugs
   qu'on découvre au pire moment ». Il n'a donc pas été écrit tant que le serveur
   tournait sous Windows — il l'est le jour où le Mac sert.
   Sur toute autre plateforme, `disponible()` répond faux et le reste ne fait
   rien : l'écran affiche « à brancher », comme avant.
   ═══════════════════════════════════════════════════════════════════════════ */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAC = process.platform === 'darwin';

/* Un appel AppleScript coûte ~100 ms. La carte Maison de l'écran mural est
   redessinée à chaque rafraîchissement : sans garde-fou on interrogerait
   Music.app en boucle. Trois secondes suffisent à absorber les rafales sans
   qu'un changement paraisse en retard. */
const CACHE_MS = 3000;
let cache = { le: 0, valeur: null };

/* Une commande AppleScript ne doit JAMAIS être construite par concaténation avec
   une valeur venue de l'extérieur : un nom d'enceinte contenant un guillemet
   suffirait à faire exécuter autre chose. On échappe, systématiquement. */
const echapper = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function osascript(script, delai = 6000) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: delai },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

/* Music.app n'est pas forcément lancé, et il ne FAUT PAS le lancer pour lire son
   état : `tell application "Music"` démarre l'application. Sur un serveur sans
   écran, ouvrir Music tout seul serait une surprise désagréable — et ça
   mettrait plusieurs secondes. On regarde donc d'abord s'il tourne. */
/* 🐞 Vérifier « Music est-il lancé ? » via System Events paraissait naturel — et
   ça ne marche pas depuis une session SSH : System Events relève de
   l'automatisation, qui demande une autorisation TCC que personne ne peut
   accorder à distance. La commande sort alors VIDE, sans erreur, et le module
   croyait Music fermé alors qu'il jouait.
   `pgrep` répond à la même question sans aucune permission, et plus vite. */
const enMarche = () => new Promise((resolve) => {
  if (!MAC) return resolve(false);
  execFile('/usr/bin/pgrep', ['-x', 'Music'], (err, out) => resolve(!err && Boolean(String(out).trim())));
});

/* Le séparateur est une chaîne improbable plutôt qu'une virgule ou un `|` : un
   titre de morceau contient très souvent l'un et l'autre. */
const SEP = '<%|%>';

const LIRE = `
tell application "Music"
  set etat to (player state as text)
  set t to ""
  set a to ""
  set al to ""
  set duree to 0
  set pos to 0
  try
    set t to name of current track
    set a to artist of current track
    set al to album of current track
    set duree to duration of current track
    set pos to player position
  end try
  set v to sound volume
  return etat & "${SEP}" & t & "${SEP}" & a & "${SEP}" & al & "${SEP}" & (duree as text) & "${SEP}" & (pos as text) & "${SEP}" & (v as text)
end tell`;

/* Les enceintes : « current AirPlay devices » donne celles qui jouent, « AirPlay
   devices » toutes celles qui sont connues. On rend les deux, sinon on ne peut
   pas afficher où le son sort ACTUELLEMENT. */
const ENCEINTES = `
tell application "Music"
  set toutes to {}
  set actives to {}
  try
    repeat with d in AirPlay devices
      set fin to (name of d)
      set toutes to toutes & fin
      if selected of d then set actives to actives & fin
    end repeat
  end try
  set AppleScript's text item delimiters to "${SEP}"
  return (toutes as text) & "<%%>" & (actives as text)
end tell`;

async function etat() {
  if (!MAC) return { disponible: false, raison: 'la musique se pilote depuis le Mac' };
  if (Date.now() - cache.le < CACHE_MS && cache.valeur) return cache.valeur;

  let v;
  if (!(await enMarche())) {
    v = { disponible: true, ouvert: false, lecture: false };
  } else {
    try {
      const [etatL, titre, artiste, album, duree, position, volume] =
        (await osascript(LIRE)).split(SEP);
      let enceintes = [], actives = [];
      try {
        const [t, a] = (await osascript(ENCEINTES)).split('<%%>');
        enceintes = t ? t.split(SEP).filter(Boolean) : [];
        actives = a ? a.split(SEP).filter(Boolean) : [];
      } catch { /* les enceintes AirPlay ne sont pas toujours lisibles ; le reste vaut quand même */ }

      v = {
        disponible: true,
        ouvert: true,
        lecture: etatL === 'playing',
        etat: etatL,
        titre: titre || null,
        artiste: artiste || null,
        album: album || null,
        duree: Number(duree) || 0,
        position: Number(position) || 0,
        volume: Number(volume),
        enceintes,
        actives,
        playlists: await playlists(),
        /* Clé = la piste, pas l'album : deux morceaux du même album partagent
           l'image, et l'empreinte du contenu le constatera toute seule. */
        pochette: await pochette(titre ? `${artiste || ''}|${titre}` : null),
      };
    } catch (e) {
      v = { disponible: true, ouvert: true, erreur: e.message };
    }
  }
  cache = { le: Date.now(), valeur: v };
  return v;
}

/* Liste FERMÉE, comme pour les actions vocales (§ 2 septies) : le serveur
   n'exécute que ce qu'il connaît. Une commande arrivant de l'écran mural ou d'un
   téléphone ne peut donc pas devenir une instruction AppleScript arbitraire. */
const COMMANDES = {
  lecture: 'play',
  pause: 'pause',
  bascule: 'playpause',
  suivant: 'next track',
  precedent: 'previous track',
};

/* Combien de résultats on renvoie. Vingt-cinq tiennent sur un panneau qu'on
   parcourt du doigt ; au-delà on ne cherche plus, on fait défiler — et une
   bibliothèque de vingt mille titres saturerait le Raspberry pour rien. */
const MAX_RESULTATS = 25;

async function commander(quoi, options = {}) {
  if (!MAC) throw new Error('la musique se pilote depuis le Mac');
  cache = { le: 0, valeur: null };      // l'état change : on ne sert plus le cache

  if (quoi === 'volume') {
    const n = Math.max(0, Math.min(100, Math.round(Number(options.valeur))));
    if (!Number.isFinite(n)) throw new Error('volume invalide');
    await osascript(`tell application "Music" to set sound volume to ${n}`);
    return { ok: true, volume: n };
  }

  if (quoi === 'enceinte') {
    /* Une enceinte se choisit par son NOM, et le nom vient de la liste que Music
       a donnée — jamais d'une chaîne libre. On vérifie donc qu'elle existe avant
       de l'employer : sinon AppleScript lève une erreur illisible. */
    const nom = String(options.nom || '');
    const e = await etat();
    if (!(e.enceintes || []).includes(nom)) throw new Error(`enceinte inconnue : ${nom}`);
    await osascript(
      `tell application "Music" to set current AirPlay devices to (get some AirPlay device whose name is "${echapper(nom)}")`);
    cache = { le: 0, valeur: null };
    return { ok: true, enceinte: nom };
  }

  /* Lancer une playlist. Comme pour l'enceinte, le nom vient de la liste que
     Music a donnée : on vérifie qu'il existe avant de l'employer, sinon
     AppleScript rend une erreur illisible — et surtout on n'exécute jamais une
     chaîne libre venue du réseau. */
  if (quoi === 'playlist') {
    const nom = String(options.nom || '');
    const dispo = await playlists();
    if (!dispo.includes(nom)) throw new Error(`playlist inconnue : ${nom}`);
    await osascript(`tell application "Music" to play playlist "${echapper(nom)}"`, 15000);
    return { ok: true, playlist: nom };
  }

  /* Un titre précis. On le désigne par son identifiant PERSISTANT, jamais par
     son nom : deux morceaux peuvent porter le même titre, et l'identifiant est
     ce que Music nous a rendu à la recherche. Contrôlé au passage — seuls des
     caractères hexadécimaux, donc rien à injecter. */
  if (quoi === 'piste') {
    const id = String(options.id || '').toUpperCase();
    if (!/^[0-9A-F]{8,32}$/.test(id)) throw new Error('identifiant de piste invalide');
    await osascript(
      `tell application "Music" to play (first track of library playlist 1 whose persistent ID is "${id}")`, 15000);
    return { ok: true, piste: id };
  }

  const ordre = COMMANDES[quoi];
  if (!ordre) throw new Error(`commande inconnue : ${quoi}`);
  /* On ne démarre pas Music.app pour une pause ou un « suivant » : s'il est
     fermé, il n'y a rien à mettre en pause. Seule la lecture peut l'ouvrir. */
  if (!(await enMarche()) && quoi !== 'lecture' && quoi !== 'bascule') {
    return { ok: false, raison: 'Music n’est pas ouvert' };
  }
  await osascript(`tell application "Music" to ${ordre}`);
  return { ok: true, commande: quoi };
}

/* ── Pochette de l'album ────────────────────────────────────────────────────
   Demandée par Rémi : « une petite vignette de la musique avec le titre ».

   On ne la renvoie PAS en base64 dans l'état : celui-ci est relu toutes les
   trente secondes, et une pochette de 200 Ko ferait trente mégaoctets par heure
   sur le Wi-Fi du Raspberry, pour une image qui ne change qu'au changement de
   morceau. On la range donc comme les photos de plats (§ 2 quinquies) : un
   fichier nommé par l'EMPREINTE DE SON CONTENU, servi en cache long. Deux
   pistes qui partagent une pochette ne la stockent qu'une fois, et le navigateur
   ne la retélécharge jamais. */
const crypto = require('crypto');
const DOSSIER_POCHETTES = path.join(__dirname, '..', 'public', 'pochettes');

/* Mémoire par PISTE : sans elle on relancerait un AppleScript et une écriture
   disque toutes les trente secondes pour le même morceau. */
const pochettesVues = new Map();
const MAX_VUES = 200;

function extensionDe(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  return null;   // format inconnu : on préfère rien plutôt qu'un fichier illisible
}

async function pochette(cle) {
  if (!MAC || !cle) return null;
  if (pochettesVues.has(cle)) return pochettesVues.get(cle);
  const tmp = path.join(os.tmpdir(), `maison-pochette-${process.pid}.bin`);
  let url = null;
  try {
    await osascript(`tell application "Music"
  set d to raw data of artwork 1 of current track
end tell
set f to open for access POSIX file "${tmp}" with write permission
set eof f to 0
write d to f
close access f`, 8000);
    const buf = fs.readFileSync(tmp);
    const ext = extensionDe(buf);
    if (ext && buf.length > 1024) {
      const nom = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
      fs.mkdirSync(DOSSIER_POCHETTES, { recursive: true });
      const dest = path.join(DOSSIER_POCHETTES, nom);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
      url = '/pochettes/' + nom;
    }
  } catch { /* pas d'artwork sur ce morceau : ce n'est pas une panne */ }
  try { fs.unlinkSync(tmp); } catch { /* déjà parti */ }
  /* On mémorise MÊME l'absence : sinon un morceau sans pochette relancerait un
     AppleScript à chaque lecture d'état. */
  if (pochettesVues.size > MAX_VUES) pochettesVues.clear();
  pochettesVues.set(cle, url);
  return url;
}

/* ── Choisir quoi écouter ───────────────────────────────────────────────────
   Jusqu'ici on ne pouvait que lancer/mettre en pause ce qui était déjà chargé.
   Sur un écran de cuisine, c'est la moitié du service. */

/* Les playlists changent rarement : un quart d'heure de cache évite de relancer
   un AppleScript à chaque ouverture du panneau. */
let cachePl = { le: 0, valeur: null };

async function playlists() {
  if (cachePl.valeur && Date.now() - cachePl.le < 15 * 60_000) return cachePl.valeur;
  if (!MAC || !(await enMarche())) return [];
  let liste = [];
  try {
    /* `user playlist` seulement : les playlists intelligentes et les dossiers
       d'Apple Music noieraient les siennes. */
    const brut = await osascript(
      'tell application "Music" to get name of every user playlist', 10000);
    liste = brut.split(', ').map((x) => x.trim()).filter(Boolean);
  } catch { /* pas d'autorisation ici : l'agent réessaiera */ }
  cachePl = { le: Date.now(), valeur: liste };
  return liste;
}

/* Recherche par titre OU artiste — `search` de Music couvre les deux, et c'est
   ce qu'on veut : on tape « Brassens » comme on tape « Les copains d'abord ».
   Aucune écriture : c'est une LECTURE, elle ne change rien à ce qui joue. */
async function chercher(texte) {
  const q = String(texte || '').trim();
  if (q.length < 2) return { resultats: [], raison: 'deux lettres au minimum' };
  if (!MAC) return { resultats: [], raison: 'se pilote depuis le Mac' };
  if (!(await enMarche())) return { resultats: [], raison: 'Music n’est pas ouvert' };
  /* Séparateur en tabulation ET fin de ligne : un titre peut contenir une
     virgule, la sortie « liste AppleScript » serait alors impossible à
     redécouper. */
  const script = `tell application "Music"
  set res to (search library playlist 1 for "${echapper(q)}")
  set out to ""
  repeat with i from 1 to (count of res)
    if i > ${MAX_RESULTATS} then exit repeat
    set t to item i of res
    set out to out & (persistent ID of t) & tab & (name of t) & tab & (artist of t) & linefeed
  end repeat
  return out
end tell`;
  try {
    const brut = await osascript(script, 20000);
    /* Les antislashs ne survivent pas à un heredoc de shell (piège déjà payé
       le 04/09) : on nomme les caractères plutôt que de les écrire. */
    const LF = String.fromCharCode(10), TAB = String.fromCharCode(9);
    const resultats = brut.split(LF).map((l) => l.split(TAB))
      .filter((c) => c.length >= 2 && c[0])
      .map((c) => ({ id: c[0].trim(), titre: (c[1] || '').trim(), artiste: (c[2] || '').trim() }));
    return { resultats };
  } catch (e) {
    return { resultats: [], raison: e.message };
  }
}

/* ── Repli par l'agent ──────────────────────────────────────────────────────
   Quand ce module est chargé PAR LE SERVEUR (un LaunchDaemon), osascript échoue :
   macOS ne peut demander l'autorisation d'automatisation à personne, puisque
   aucune session graphique n'est ouverte pour ce processus. On passe alors la
   main à l'agent, qui lui vit dans la session de Rémi et a l'autorisation.
   Si l'agent n'est pas là non plus, on rend l'erreur d'origine : mieux vaut dire
   ce qui manque que masquer la panne. */
const AGENT = `http://127.0.0.1:${Number(process.env.MUSIQUE_AGENT_PORT) || 8091}`;

async function viaAgent(chemin, corps) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(AGENT + chemin, {
      method: corps ? 'POST' : 'GET',
      headers: corps ? { 'Content-Type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    return await r.json();
  } finally { clearTimeout(t); }
}

/* Enveloppes publiques : elles essaient en direct, puis l'agent. L'ordre compte
   — lancé depuis un terminal (donc avec l'autorisation), le direct répond en
   100 ms sans dépendre de l'agent. */
async function etatOuAgent() {
  const e = await etat();
  if (!e.erreur) return e;
  try { const a = await viaAgent('/etat'); return a && !a.erreur ? a : e; } catch { return e; }
}

async function chercherOuAgent(texte) {
  const r = await chercher(texte);
  if (r.resultats.length || !MAC) return r;
  try {
    const a = await viaAgent('/chercher?q=' + encodeURIComponent(String(texte || '')));
    return a && Array.isArray(a.resultats) ? a : r;
  } catch { return r; }
}

async function commanderOuAgent(quoi, options = {}) {
  try { return await commander(quoi, options); }
  catch (direct) {
    /* Une commande INCONNUE est un refus légitime : on ne la rejoue pas contre
       l'agent, qui la refuserait pareil. Seule une panne d'autorisation vaut un
       second essai. */
    if (/commande inconnue|enceinte inconnue|volume invalide/.test(direct.message)) throw direct;
    try {
      const r = await viaAgent('/commande', { commande: quoi, ...options });
      if (r && r.erreur) throw new Error(r.erreur);
      return r;
    } catch { throw direct; }
  }
}

/* Vidé à la demande : la liste des enceintes AirPlay change quand un appareil
   s'allume ou redémarre, et attendre le cache donnerait l'impression que le
   nouvel appareil n'est pas reconnu. */
const viderCache = () => { cache = { le: 0, valeur: null }; };

/* ── Enceinte par défaut ────────────────────────────────────────────────────
   Rémi veut que le son sorte sur la barre proche de l'écran de cuisine sans
   avoir à y penser. Mais basculer une sortie audio TOUT SEUL peut couper la
   musique de quelqu'un qui écoute ailleurs — d'où deux garde-fous :
     • on ne touche à rien PENDANT une lecture ;
     • et on ne réapplique pas si c'est déjà la bonne sortie, sinon on écrirait
       à chaque lecture d'état.
   Le nom est un réglage, jamais codé en dur : aucun foyer dans le code. */
let dernierEssai = 0;

async function appliquerDefaut(nom) {
  const voulu = String(nom || '').trim();
  if (!MAC || !voulu) return { applique: false, raison: 'aucune enceinte par défaut' };
  /* Une minute entre deux tentatives : si l'enceinte est absente (éteinte), on
     ne relance pas un AppleScript à chaque rafraîchissement de l'écran. */
  if (Date.now() - dernierEssai < 60_000) return { applique: false, raison: 'déjà tenté récemment' };

  const e = await etat();
  if (!e.ouvert || e.erreur) return { applique: false, raison: 'Music indisponible' };
  if (e.lecture) return { applique: false, raison: 'lecture en cours — on ne coupe pas' };
  if ((e.actives || []).includes(voulu)) return { applique: false, raison: 'déjà la sortie active' };
  if (!(e.enceintes || []).includes(voulu)) {
    dernierEssai = Date.now();
    return { applique: false, raison: `« ${voulu} » n'est pas visible (éteinte ?)` };
  }
  dernierEssai = Date.now();
  await commander('enceinte', { nom: voulu });
  return { applique: true, enceinte: voulu };
}


const disponible = () => MAC;

module.exports = { disponible, viderCache, appliquerDefaut, etat: etatOuAgent, commander: commanderOuAgent,
                   etatDirect: etat, commanderDirect: commander, COMMANDES,
                   chercher: chercherOuAgent, chercherDirect: chercher, playlists };
