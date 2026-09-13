'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Notifications push — le chiffrement, PROUVÉ.

   POURQUOI CE BANC EST INDISPENSABLE : une erreur de chiffrement Web Push est
   SILENCIEUSE. Le service de push accepte le message (201), le téléphone le
   reçoit, ne parvient pas à le lire, et le jette. Rien n'apparaît nulle part —
   ni erreur serveur, ni notification. On chercherait du côté de la permission,
   de l'installation, du service worker… pendant des heures.

   On joue donc le rôle du NAVIGATEUR : on génère une paire comme le ferait un
   iPhone, on demande au serveur de chiffrer, et on déchiffre. Si le message
   ressort intact, le protocole est respecté — c'est la seule preuve qui vaille
   sans un téléphone sous la main.
   ═══════════════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const path = require('path');
const A = require('./aide');

/* Ce que fait un navigateur pour lire un push (RFC 8291). Écrit à part et non
   dans le module : un test qui réutiliserait le code du serveur pour vérifier
   le serveur ne prouverait rien. */
function dechiffrerCommeUnNavigateur(corps, ecdhClient, authSecret) {
  const sel = corps.subarray(0, 16);
  const lenCle = corps.readUInt8(20);
  const servPub = corps.subarray(21, 21 + lenCle);
  const chiffre = corps.subarray(21 + lenCle);

  const partage = ecdhClient.computeSecret(servPub);
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'), ecdhClient.getPublicKey(), servPub,
  ]);
  const prk = Buffer.from(crypto.hkdfSync('sha256', partage, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, sel,
    Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, sel,
    Buffer.from('Content-Encoding: nonce\0'), 12));

  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  return { texte: clair.subarray(0, clair.length - 1).toString('utf8'), delimiteur: clair[clair.length - 1] };
}

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  const push = require(path.join(__dirname, '..', '..', 'push'));

  t.titre('Clés du serveur (VAPID)');
  const pub = push.clePublique();
  t.dire(/^[A-Za-z0-9_-]+$/.test(pub), 'la clé publique est en base64url', pub.slice(0, 16) + '…');
  t.dire(push.deB64url(pub).length === 65, 'elle fait 65 octets (point non compressé)',
    push.deB64url(pub).length + ' octets');
  t.dire(push.deB64url(pub)[0] === 4, 'elle commence par 0x04, comme l’exige le navigateur');
  /* Deux appels doivent rendre LA MÊME clé : en régénérer invaliderait tous les
     abonnements d'un coup, sans le moindre message. */
  t.dire(push.clePublique() === pub, '🔑 la clé ne change pas d’un appel à l’autre');

  t.titre('Jeton VAPID');
  const j = push.jeton('https://web.push.apple.com', 'mailto:famille@exemple.fr');
  const [tete, corps, sig] = j.split('.');
  t.dire(JSON.parse(Buffer.from(tete, 'base64url').toString()).alg === 'ES256', 'signé en ES256');
  /* 🔑 64 octets BRUTS. Node signe en DER par défaut, et un JWT en DER est
     refusé par le service de push avec un 401 qui n'explique rien. */
  t.dire(Buffer.from(sig, 'base64url').length === 64,
    '🔑 signature de 64 octets (bruts, pas DER)', Buffer.from(sig, 'base64url').length + ' octets');
  const p = JSON.parse(Buffer.from(corps, 'base64url').toString());
  t.dire(p.aud === 'https://web.push.apple.com', 'l’audience est l’origine du service');
  const heures = (p.exp - Math.floor(Date.now() / 1000)) / 3600;
  t.dire(heures > 1 && heures <= 24, 'expiration dans la fenêtre admise (≤ 24 h)',
    Math.round(heures) + ' h');

  t.titre('Chiffrement du message');
  const cli = crypto.createECDH('prime256v1'); cli.generateKeys();
  const auth = crypto.randomBytes(16);
  const MSG = 'Enora est rentrée · 2 devoirs pour demain';

  const chiffre = push.chiffrer(MSG, push.b64url(cli.getPublicKey()), push.b64url(auth));
  t.dire(chiffre.readUInt32BE(16) === 4096, 'la taille d’enregistrement est annoncée');
  t.dire(chiffre.readUInt8(20) === 65, 'la clé éphémère fait 65 octets');

  const lu = dechiffrerCommeUnNavigateur(chiffre, cli, auth);
  t.dire(lu.texte === MSG, '🔑 un navigateur déchiffre exactement le message', lu.texte);
  /* Sans ce délimiteur, le navigateur rejette le message en silence. */
  t.dire(lu.delimiteur === 2, 'le délimiteur de fin (0x02) est présent');

  /* Deux envois du même texte ne doivent pas produire le même bloc : le sel et
     la clé éphémère sont tirés à chaque fois. Sinon deux messages identiques
     seraient reconnaissables par qui les transporte. */
  const bis = push.chiffrer(MSG, push.b64url(cli.getPublicKey()), push.b64url(auth));
  t.dire(!chiffre.equals(bis), 'deux envois identiques donnent deux blocs différents');

  /* Une clé client mal formée doit être refusée MAINTENANT, pas produire un
     message que personne ne pourra lire. */
  let refuse = false;
  try { push.chiffrer('x', push.b64url(Buffer.alloc(10)), push.b64url(auth)); }
  catch (_) { refuse = true; }
  t.dire(refuse, 'une clé de client invalide est refusée tout de suite');

  return t;
};
