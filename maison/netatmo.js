'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Netatmo — température LUE et RÉGLÉE, par l'API officielle.

   POURQUOI on abandonne le Raccourci HomeKit pour ça (§ 2 untricies) :
   • Le Raccourci ne lisait rien sans hub HomeKit allumé — et seuls un HomePod
     ou une Apple TV peuvent être hub, jamais le Mac mini. Une Apple TV éteinte
     un soir, et l'écran mural n'a plus de température.
   • Surtout, Rémi veut AGIR sur la consigne. `shortcuts run` ne sait pas passer
     un paramètre : il faudrait un raccourci par température. L'API prend le
     nombre.
   ⚠️ Prix à payer, dit franchement : trois valeurs à créer une fois sur
   dev.netatmo.com/apps. C'est le seul endroit du projet où l'on stocke des
   identifiants d'un service tiers pour la maison.

   🔴 LE PIÈGE : Netatmo fait TOURNER le jeton de rafraîchissement à chaque
   usage — comme Pronote (§ 2 duovicies), et pour la même raison, avec la même
   conséquence si on l'ignore : le premier échec silencieux tue l'accès et il
   faut tout recommencer à la main. On le persiste donc AVANT de s'en servir,
   dans un fichier hors dépôt ; le `.env` n'est qu'une valeur d'amorçage
   (même règle que les réglages, § 2 septies).
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const API = 'https://api.netatmo.com';
const ETAT = path.join(__dirname, 'netatmo-jeton.json');

/* La topologie (maisons, pièces, modules) ne bouge jamais : une fois par heure
   suffit. L'état, lui, porte les températures — une minute, comme le reste du
   bandeau maison. */
const CACHE_TOPO_MS = 60 * 60_000;
const CACHE_ETAT_MS = 60_000;

/* Bornes de sécurité. Le serveur n'exécute que ce qu'il comprend : une consigne
   à 45 °C venue d'un doigt qui a glissé ne part pas. */
const MIN = 5, MAX = 30;

let acces = { jeton: null, expire: 0 };
let topo = { le: 0, valeur: null };
let etatCache = { le: 0, valeur: null };

const conf = () => ({
  id: process.env.NETATMO_CLIENT_ID || '',
  secret: process.env.NETATMO_CLIENT_SECRET || '',
});

function lireRafraichissement() {
  try {
    const j = JSON.parse(fs.readFileSync(ETAT, 'utf8'));
    if (j && j.refresh) return j.refresh;
  } catch { /* premier démarrage : on retombe sur l'amorçage */ }
  return process.env.NETATMO_REFRESH_TOKEN || '';
}

function ecrireRafraichissement(refresh) {
  try {
    fs.writeFileSync(ETAT, JSON.stringify({ refresh, le: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (e) {
    /* Si on ne peut pas l'écrire, le prochain démarrage réutilisera un jeton
       périmé et l'accès sera perdu. Ça se dit fort. */
    throw new Error('jeton Netatmo non enregistré (' + e.message + ') — le prochain démarrage échouerait');
  }
}

function configure() {
  const c = conf();
  if (!c.id || !c.secret) return { ok: false, raison: 'NETATMO_CLIENT_ID / NETATMO_CLIENT_SECRET absents du .env' };
  if (!lireRafraichissement()) return { ok: false, raison: 'NETATMO_REFRESH_TOKEN absent du .env' };
  return { ok: true };
}

async function jeton() {
  if (acces.jeton && Date.now() < acces.expire) return acces.jeton;
  const c = conf();
  const refresh = lireRafraichissement();
  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refresh,
      client_id: c.id, client_secret: c.secret,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(j.error_description || j.error
      || `refus de Netatmo (${r.status}) — le jeton de rafraîchissement est-il encore valable ?`);
  }
  /* On persiste le NOUVEAU jeton avant de rendre l'accès : si l'écriture échoue,
     mieux vaut échouer maintenant que découvrir la perte au redémarrage. */
  if (j.refresh_token && j.refresh_token !== refresh) ecrireRafraichissement(j.refresh_token);
  acces = { jeton: j.access_token, expire: Date.now() + Math.max(60, (j.expires_in || 10800) - 300) * 1000 };
  return acces.jeton;
}

async function appel(chemin, params = {}, methode = 'GET') {
  const t = await jeton();
  const opts = { method: methode, headers: { authorization: `Bearer ${t}` } };
  let url = `${API}/api/${chemin}`;
  if (methode === 'GET') {
    const q = new URLSearchParams(params).toString();
    if (q) url += `?${q}`;
  } else {
    opts.headers['content-type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params);
  }
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 10_000);
  let r, j;
  try {
    r = await fetch(url, { ...opts, signal: ctrl.signal });
    j = await r.json().catch(() => ({}));
  } finally { clearTimeout(minuteur); }
  if (!r.ok) {
    /* 403 = jeton d'accès périmé plus tôt que prévu : on le jette et on rejoue
       UNE fois. Insister au-delà, c'est marteler l'API pour rien. */
    if (r.status === 403 && acces.jeton) { acces = { jeton: null, expire: 0 }; return appel(chemin, params, methode); }
    throw new Error((j.error && (j.error.message || j.error)) || `Netatmo a répondu ${r.status}`);
  }
  return j.body || j;
}

async function topologie() {
  if (topo.valeur && Date.now() - topo.le < CACHE_TOPO_MS) return topo.valeur;
  const b = await appel('homesdata');
  const maison = (b.homes || [])[0];
  if (!maison) throw new Error('aucune maison dans ce compte Netatmo');
  topo = { le: Date.now(), valeur: maison };
  return maison;
}

/* Une pièce Netatmo n'a pas toujours de thermostat : certaines ne portent qu'un
   capteur. On garde les deux — savoir qu'il fait 17 °C dans une chambre a de la
   valeur même si on ne peut rien y régler. */
function pieces(maison, statut) {
  const noms = new Map((maison.rooms || []).map((r) => [r.id, r.name]));
  return (statut.rooms || []).map((r) => ({
    id: String(r.id),
    nom: noms.get(r.id) || 'Pièce',
    mesuree: typeof r.therm_measured_temperature === 'number' ? r.therm_measured_temperature : null,
    consigne: typeof r.therm_setpoint_temperature === 'number' ? r.therm_setpoint_temperature : null,
    mode: r.therm_setpoint_mode || null,
    chauffe: r.heating_power_request > 0,
    reglable: r.therm_setpoint_temperature !== undefined,
  })).filter((p) => p.mesuree !== null || p.consigne !== null);
}

/* La station météo, si le compte en a une, donne l'extérieur — que le thermostat
   ne connaît pas. Optionnel : son absence n'est pas une panne. */
async function exterieur() {
  try {
    const b = await appel('getstationsdata', { get_favorites: 'false' });
    for (const d of b.devices || []) {
      for (const m of d.modules || []) {
        if (m.type === 'NAModule1' && m.dashboard_data && typeof m.dashboard_data.Temperature === 'number') {
          return { nom: m.module_name || 'Extérieur', valeur: m.dashboard_data.Temperature };
        }
      }
    }
  } catch { /* pas de station, ou pas le scope : sans objet */ }
  return null;
}

/* La pièce mise en avant sur le mur est un RÉGLAGE, pas la première venue :
   « Bureau » et « Salle à manger » ne disent pas la même chose à qui traverse la
   cuisine. Vide = la première qui a une mesure. Comparaison sans accent ni
   casse — on ne retape pas « Salle à manger » à l'identique dans un formulaire. */
const clef = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function etat(pieceVoulue = '') {
  const c = configure();
  if (!c.ok) return { disponible: false, raison: c.raison };
  if (etatCache.valeur && Date.now() - etatCache.le < CACHE_ETAT_MS
      && etatCache.piece === clef(pieceVoulue)) return etatCache.valeur;
  let v;
  try {
    const maison = await topologie();
    const statut = await appel('homestatus', { home_id: maison.id });
    const liste = pieces(maison, statut.home || {});
    v = {
      disponible: true, maisonId: maison.id, maison: maison.name || 'Maison',
      pieces: liste, exterieur: await exterieur(),
      /* Si la pièce demandée n'a pas de mesure (une vanne seule n'en donne pas
         toujours), on ne montre pas un tiret : on retombe sur la première qui en
         a une. Mieux vaut une autre pièce nommée qu'un vide inexpliqué. */
      principale: liste.find((p) => clef(p.nom) === clef(pieceVoulue) && p.mesuree !== null)
        || liste.find((p) => p.mesuree !== null) || liste[0] || null,
    };
  } catch (e) {
    v = { disponible: false, raison: e.message };
  }
  etatCache = { le: Date.now(), valeur: v, piece: clef(pieceVoulue) };
  return v;
}

/* ── Agir : consigne manuelle sur une pièce ─────────────────────────────────
   Volontairement la SEULE écriture. Pas de « tout couper », pas de mode absence
   depuis l'écran : ce projet n'expose pas d'opération de masse, et une dalle
   tactile dans une cuisine se touche par accident (§ 2 septies). */
async function consigne(pieceId, temperature, minutes = 180) {
  const c = configure();
  if (!c.ok) return { ok: false, raison: c.raison };
  const t = Number(temperature);
  if (!Number.isFinite(t) || t < MIN || t > MAX) {
    return { ok: false, raison: `consigne hors bornes (${MIN}–${MAX} °C)` };
  }
  const duree = Math.min(Math.max(Number(minutes) || 180, 15), 24 * 60);
  try {
    const maison = await topologie();
    const courant = await etat();
    if (!(courant.pieces || []).some((p) => p.id === String(pieceId))) {
      return { ok: false, raison: 'pièce inconnue' };
    }
    await appel('setroomthermpoint', {
      home_id: maison.id, room_id: String(pieceId), mode: 'manual',
      temp: t.toFixed(1),
      endtime: String(Math.floor(Date.now() / 1000) + duree * 60),
    }, 'POST');
    etatCache = { le: 0, valeur: null };   // la consigne a changé : on relit
    return { ok: true, temperature: t, minutes: duree };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

const viderCache = () => { topo = { le: 0, valeur: null }; etatCache = { le: 0, valeur: null }; };

module.exports = { etat, consigne, configure, viderCache, MIN, MAX };
