'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Notifications push — téléphone verrouillé, dans la poche.

   Demandé depuis le 18/08 et bloqué par trois conditions que seul le HTTPS
   permettait de réunir : contexte sécurisé, service worker, et — sur iOS —
   l'app AJOUTÉE À L'ÉCRAN D'ACCUEIL. Ce dernier point n'est pas une option :
   Safari refuse d'abonner un onglet ordinaire.

   ── POURQUOI SANS BIBLIOTHÈQUE ───────────────────────────────────────────
   `web-push` ferait l'affaire, mais Node a déjà tout : ECDH P-256, HKDF,
   AES-128-GCM et la signature ES256. Le protocole tient en une page (RFC 8291
   pour le chiffrement, RFC 8292 pour VAPID), et une dépendance de moins, c'est
   une mise à jour de moins à surveiller.
   ⚠️ En contrepartie, une erreur ici est SILENCIEUSE : le push part, le service
   l'accepte, et rien n'arrive. D'où les vecteurs de test de la RFC dans la
   suite de tests — c'est le seul moyen de prouver que le chiffrement est juste
   sans un téléphone sous la main.

   ── CE QUI VOYAGE ────────────────────────────────────────────────────────
   Le message est chiffré POUR l'appareil, avec des clés qu'il a lui-même
   générées. Ni Apple ni Google ne peuvent le lire : ils ne voient qu'un bloc
   opaque et une adresse de livraison. C'est ce qui rend acceptable de faire
   transiter « Enora est rentrée » ou « devoirs pour demain ».
   ═══════════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, 'push-vapid.json');

const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* ── Les clés du serveur ───────────────────────────────────────────────────
   Générées une fois, puis conservées. ⚠️ Elles ne doivent JAMAIS changer : la
   clé publique est enregistrée dans chaque abonnement au moment de l'abonnement.
   En générer de nouvelles invaliderait tous les téléphones d'un coup, sans
   message — ils cesseraient simplement de recevoir.
   Hors dépôt, comme le jeton Netatmo : c'est un secret. */
function cles() {
  if (fs.existsSync(FICHIER)) {
    try { return JSON.parse(fs.readFileSync(FICHIER, 'utf8')); }
    catch { /* fichier abîmé : on en refait une paire ci-dessous */ }
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  /* Format « point non compressé » : 0x04 || X || Y. C'est celui qu'attend le
     navigateur dans `applicationServerKey`. */
  const brut = Buffer.concat([Buffer.from([4]), deB64url(pub.x), deB64url(pub.y)]);
  const c = { publique: b64url(brut), privee: priv.d, x: pub.x, y: pub.y };
  fs.writeFileSync(FICHIER, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}

const clePublique = () => cles().publique;

function cleEcPrivee() {
  const c = cles();
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: c.x, y: c.y, d: c.privee },
    format: 'jwk',
  });
}

/* ── VAPID : prouver au service de push qui nous sommes ───────────────────
   Un JWT signé ES256. ⚠️ `dsaEncoding: 'ieee-p1363'` est obligatoire : un JWT
   attend 64 octets bruts, là où Node signe en DER par défaut. Avec du DER, le
   service refuse en 401 — et le message d'erreur ne dit pas pourquoi. */
function jeton(audience, sujet) {
  const tete = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64url(JSON.stringify({
    aud: audience,
    /* 12 h : la RFC plafonne à 24 h. Plus court obligerait à re-signer souvent
       pour rien, plus long est refusé. */
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: sujet,
  }));
  const signe = crypto.sign('sha256', Buffer.from(`${tete}.${corps}`),
    { key: cleEcPrivee(), dsaEncoding: 'ieee-p1363' });
  return `${tete}.${corps}.${b64url(signe)}`;
}

/* ── Chiffrement RFC 8291 (aes128gcm) ─────────────────────────────────────
   Le corps envoyé est :
     salt(16) | taille(4) | longueur de la clé(1) | clé éphémère(65) | chiffré
   Le destinataire retrouve la clé avec SA clé privée : personne d'autre ne
   peut lire, pas même le service de push. */
function chiffrer(message, p256dhB64, authB64) {
  const clientPub = deB64url(p256dhB64);
  const authSecret = deB64url(authB64);
  if (clientPub.length !== 65) throw new Error('clé du client invalide');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serveurPub = ecdh.getPublicKey();
  const partage = ecdh.computeSecret(clientPub);

  /* Première dérivation : elle lie le secret partagé AUX DEUX clés publiques.
     C'est ce qui empêche de rejouer un message chiffré vers un autre appareil. */
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'), clientPub, serveurPub,
  ]);
  const prk = Buffer.from(crypto.hkdfSync('sha256', partage, authSecret, info, 32));

  const sel = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, sel,
    Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, sel,
    Buffer.from('Content-Encoding: nonce\0'), 12));

  /* 0x02 marque la fin du contenu — sans ce délimiteur, le navigateur rejette
     le message en silence. */
  const clair = Buffer.concat([Buffer.from(message, 'utf8'), Buffer.from([2])]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([c.update(clair), c.final(), c.getAuthTag()]);

  const entete = Buffer.alloc(5);
  entete.writeUInt32BE(4096, 0);       // taille d'enregistrement
  entete.writeUInt8(65, 4);            // longueur de la clé qui suit
  return Buffer.concat([sel, entete, serveurPub, chiffre]);
}

/* ── Envoi ────────────────────────────────────────────────────────────────
   Rend `{ok}` ou `{ok:false, perime:true}`. Le second cas compte autant que le
   premier : 404 et 410 signifient « cet abonnement n'existe plus » — app
   désinstallée, permission retirée, téléphone réinitialisé. L'appelant doit
   alors le retirer, sinon la table se remplit d'abonnements morts qu'on
   réessaie indéfiniment. */
async function envoyer(abonnement, message, { sujet = 'mailto:maison@localhost', ttl = 86400 } = {}) {
  if (!abonnement || !abonnement.endpoint) return { ok: false, raison: 'abonnement vide' };
  const url = new URL(abonnement.endpoint);
  const corps = chiffrer(typeof message === 'string' ? message : JSON.stringify(message),
    abonnement.p256dh, abonnement.auth);

  const r = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(corps.length),
      TTL: String(ttl),
      /* `Urgency: high` sinon iOS peut retarder la livraison de plusieurs
         minutes — ce qui ruine l'intérêt d'un rappel. */
      Urgency: 'high',
      Authorization: `vapid t=${jeton(url.origin, sujet)}, k=${clePublique()}`,
    },
    body: corps,
  });

  if (r.status === 404 || r.status === 410) return { ok: false, perime: true, statut: r.status };
  if (!r.ok) {
    const texte = await r.text().catch(() => '');
    return { ok: false, statut: r.status, raison: texte.slice(0, 160) };
  }
  return { ok: true, statut: r.status };
}

module.exports = { clePublique, envoyer, chiffrer, jeton, b64url, deB64url, FICHIER };
