'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Face ID / Touch ID — WebAuthn, sans aucune dépendance.

   Demandé par Rémi depuis le 18/08, et bloqué jusqu'ici par l'absence de
   HTTPS : `navigator.credentials` n'existe tout simplement pas en HTTP. Le
   tunnel Cloudflare l'a débloqué le 13/09.

   ⚠️ Et il a fallu corriger une affirmation fausse portée par le projet depuis
   un mois : « la colonne `passkey` attend déjà en base ». Elle n'existait pas.
   Rien n'était prêt.

   ── POURQUOI SANS BIBLIOTHÈQUE ───────────────────────────────────────────
   Vérifier une signature WebAuthn demande normalement de décoder du CBOR, ce
   qui justifie une dépendance. On s'en passe grâce à `getPublicKey()`, que le
   NAVIGATEUR expose depuis 2021 : il rend la clé publique déjà au format SPKI,
   celui que Node sait lire directement. Plus de CBOR, donc plus de dépendance
   à tenir à jour — et le projet garde sa règle : rien à installer.

   ── CE QUI EST VÉRIFIÉ, ET POURQUOI CHAQUE POINT COMPTE ──────────────────
   1. le DÉFI : tiré au sort, à usage unique, valable deux minutes. Sans lui,
      une signature interceptée servirait indéfiniment (rejeu).
   2. le TYPE : `webauthn.get` à la connexion. Sinon une signature obtenue lors
      d'un enregistrement pourrait servir à se connecter.
   3. l'ORIGINE : exactement notre domaine. C'est ce qui rend l'hameçonnage
      impossible — un site pirate ne peut pas obtenir de signature valide.
   4. le rpIdHash : l'empreinte du domaine, écrite par l'appareil lui-même.
   5. le drapeau UP, et UV quand on l'exige : « l'utilisateur était présent »,
      et « il s'est authentifié » — c'est UV qui signifie vraiment Face ID.
   6. le COMPTEUR : s'il recule, la clé a probablement été clonée.
   ═══════════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* Défis en mémoire : ils vivent deux minutes et meurent avec le serveur. Les
   écrire en base fabriquerait une trace des tentatives de connexion — ce projet
   n'en fabrique pas (§ 2 vicies) — et ne servirait à rien : un défi expiré est
   un défi inutile. */
const defis = new Map();
const DUREE_DEFI = 2 * 60 * 1000;

function nouveauDefi(cle) {
  purger();
  const valeur = b64url(crypto.randomBytes(32));
  defis.set(cle, { valeur, expire: Date.now() + DUREE_DEFI });
  return valeur;
}

/* Consommé, donc utilisable UNE fois : c'est ce qui interdit le rejeu. */
function prendreDefi(cle) {
  const d = defis.get(cle);
  defis.delete(cle);
  if (!d || d.expire < Date.now()) return null;
  return d.valeur;
}

function purger() {
  const t = Date.now();
  for (const [k, d] of defis) if (d.expire < t) defis.delete(k);
  /* Un attaquant qui demanderait des milliers de défis ne doit pas faire
     grossir la mémoire indéfiniment. */
  if (defis.size > 1000) {
    const vieux = [...defis.entries()].sort((a, b) => a[1].expire - b[1].expire);
    for (const [k] of vieux.slice(0, 500)) defis.delete(k);
  }
}

/* ── Lecture de `authenticatorData` ────────────────────────────────────────
   37 octets au minimum : 32 pour l'empreinte du domaine, 1 de drapeaux,
   4 de compteur. Le reste ne nous intéresse pas ici. */
function lireAuthData(buf) {
  if (!buf || buf.length < 37) throw new Error('authenticatorData trop court');
  return {
    rpIdHash: buf.subarray(0, 32),
    up: (buf[32] & 0x01) !== 0,          // utilisateur présent (il a touché)
    uv: (buf[32] & 0x04) !== 0,          // utilisateur vérifié (Face ID, code)
    compteur: buf.readUInt32BE(33),
  };
}

function verifierClientData(clientDataJSON, { typeAttendu, defiAttendu, origines }) {
  let c;
  try { c = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); }
  catch { throw new Error('clientData illisible'); }

  if (c.type !== typeAttendu) throw new Error(`type inattendu : ${c.type}`);
  /* Comparaison à temps constant : sur une valeur secrète, comparer avec `===`
     laisse fuir sa longueur commune par le temps de réponse. */
  const a = Buffer.from(String(c.challenge || ''));
  const b = Buffer.from(String(defiAttendu || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('défi incorrect ou expiré');
  }
  if (!origines.includes(c.origin)) throw new Error(`origine refusée : ${c.origin}`);
  return c;
}

/* Le format des clés : ES256 est ce que produisent les appareils Apple ; RS256
   existe sur certains authentificateurs et ne coûte rien à accepter.
   `dsaEncoding: 'der'` est obligatoire pour ES256 — WebAuthn signe en DER, là
   où Node attend du brut par défaut, et la vérification échouerait toujours
   sans qu'on comprenne pourquoi. */
function verifierSignature({ cleSpkiB64, algo, authenticatorData, clientDataJSON, signature }) {
  const cle = crypto.createPublicKey({
    key: Buffer.from(cleSpkiB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const empreinteClient = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signe = Buffer.concat([Buffer.from(authenticatorData), empreinteClient]);

  if (Number(algo) === -257) {
    return crypto.verify('sha256', signe, cle, Buffer.from(signature));
  }
  return crypto.verify('sha256', signe,
    { key: cle, dsaEncoding: 'der' }, Buffer.from(signature));
}

/* ── Connexion ─────────────────────────────────────────────────────────────
   `cherche(idB64)` rend la clé enregistrée, ou null. On l'injecte plutôt que
   d'appeler la base ici : ce module reste pur, donc testable sans rien monter
   — même choix que pour `accueil.js` et `rappels.js`. */
function verifierConnexion({ reponse, defi, rpId, origines, cherche, exigerUV = true }) {
  if (!reponse || !reponse.id) throw new Error('réponse vide');
  const enregistre = cherche(reponse.id);
  /* L'identifiant est DIT dans l'erreur : sans lui, « appareil inconnu » oblige
     à deviner s'il s'agit d'une clé jamais enregistrée, d'un encodage qui
     diffère, ou d'un téléphone qui a proposé autre chose. Il part au journal du
     serveur, jamais au client. Ce n'est pas un secret : un credential_id est un
     identifiant public, sans valeur sans la clé privée. */
  if (!enregistre) throw new Error('appareil inconnu (id reçu : ' + String(reponse.id).slice(0, 40) + ')');

  const clientDataJSON = deB64url(reponse.clientDataJSON);
  const authData = deB64url(reponse.authenticatorData);
  const signature = deB64url(reponse.signature);

  verifierClientData(clientDataJSON, { typeAttendu: 'webauthn.get', defiAttendu: defi, origines });

  const a = lireAuthData(authData);
  const attendu = crypto.createHash('sha256').update(rpId).digest();
  if (!crypto.timingSafeEqual(a.rpIdHash, attendu)) throw new Error('domaine incorrect');
  if (!a.up) throw new Error('aucune action de l’utilisateur');
  if (exigerUV && !a.uv) throw new Error('Face ID ou code de l’appareil requis');

  const bon = verifierSignature({
    cleSpkiB64: enregistre.cle,
    algo: enregistre.algo,
    authenticatorData: authData, clientDataJSON, signature,
  });
  if (!bon) throw new Error('signature invalide');

  /* Un compteur qui RECULE signale une clé dupliquée. Beaucoup d'appareils
     Apple laissent le compteur à zéro : dans ce cas il n'apprend rien et on ne
     refuse pas — refuser ici bloquerait tous les iPhone. */
  if (a.compteur > 0 && enregistre.compteur > 0 && a.compteur <= enregistre.compteur) {
    throw new Error('compteur suspect — appareil possiblement dupliqué');
  }
  return { personne: enregistre.personne, compteur: a.compteur, uv: a.uv };
}

/* ── Enregistrement ────────────────────────────────────────────────────────
   Le navigateur nous donne déjà la clé au format SPKI : on vérifie le défi et
   l'origine, puis on range. L'attestation n'est PAS vérifiée, et c'est un choix
   assumé : elle sert à prouver la marque du matériel, ce qui n'a aucun sens
   dans une maison — on veut savoir que c'est le téléphone de Martial, pas
   qu'Apple l'a fabriqué. */
function verifierEnregistrement({ reponse, defi, origines }) {
  if (!reponse || !reponse.id || !reponse.cle) throw new Error('réponse incomplète');
  const clientDataJSON = deB64url(reponse.clientDataJSON);
  verifierClientData(clientDataJSON, { typeAttendu: 'webauthn.create', defiAttendu: defi, origines });

  /* La clé doit être lisible MAINTENANT : découvrir qu'elle ne l'est pas au
     premier déverrouillage, c'est un Face ID qui ne marche jamais sans qu'on
     sache pourquoi. */
  try {
    crypto.createPublicKey({ key: Buffer.from(reponse.cle, 'base64'), format: 'der', type: 'spki' });
  } catch (e) { throw new Error('clé publique illisible : ' + e.message); }

  return { id: reponse.id, cle: reponse.cle, algo: Number(reponse.algo) || -7 };
}

module.exports = {
  nouveauDefi, prendreDefi,
  verifierEnregistrement, verifierConnexion,
  lireAuthData, verifierSignature, b64url, deB64url,
  DUREE_DEFI,
};
