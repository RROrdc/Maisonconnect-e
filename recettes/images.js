/* Photos de plats — téléchargées une fois, servies en LOCAL.

   Pointer l'URL distante aurait été plus court, et faux : l'écran mural doit
   garder ses vignettes quand Internet tombe (règle « sans CDN » du projet).

   Nommage par empreinte SHA-1 du CONTENU, pas par nom de plat :
   - deux plats qui partagent la même image ne la stockent qu'une fois ;
   - re-télécharger la même photo ne crée pas de doublon ;
   - renommer un plat ne casse pas sa vignette.

   ⚠️ `Referer` obligatoire : les hébergeurs d'images refusent en 503/403 une
      requête qui n'annonce pas la page d'origine (anti-hotlink).
   ⚠️ Pas de redimensionnement : il faudrait `sharp`, module natif impossible à
      installer sans droits admin. À faire sur le Mac mini — 9 photos pèsent déjà
      3 Mo, ce n'est pas tenable à trente. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { estPlaceholder } = require('./commun');

const DOSSIER = path.join(__dirname, '..', 'public', 'plats');
const URL_PUBLIQUE = '/plats';
const TAILLE_MAX = 8 * 1024 * 1024;

const EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
};

function dossier() {
  if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER, { recursive: true });
  return DOSSIER;
}

function ranger(octets, type) {
  const ext = EXTENSIONS[String(type || '').toLowerCase().split(';')[0].trim()] || '.jpg';
  const nom = crypto.createHash('sha1').update(octets).digest('hex') + ext;
  const cible = path.join(dossier(), nom);
  if (!fs.existsSync(cible)) fs.writeFileSync(cible, octets);
  return `${URL_PUBLIQUE}/${nom}`;
}

async function telecharger(url, pageOrigine) {
  if (!url || estPlaceholder(url)) return '';
  const entetes = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    'accept': 'image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8',
  };
  if (pageOrigine) {
    entetes.referer = pageOrigine;
    try { entetes.origin = new URL(pageOrigine).origin; } catch (_) { /* lien tordu : on s'en passe */ }
  }

  let r;
  try { r = await fetch(url, { headers: entetes, redirect: 'follow', signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`Image injoignable (${e.message}).`); }
  if (!r.ok) throw new Error(`L'hébergeur d'images a répondu ${r.status} (anti-hotlink).`);

  const type = r.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) throw new Error(`Ce lien ne renvoie pas une image (${type || 'type inconnu'}).`);

  const octets = Buffer.from(await r.arrayBuffer());
  if (!octets.length) throw new Error('Image vide.');
  if (octets.length > TAILLE_MAX) throw new Error('Image trop lourde (plus de 8 Mo).');
  return ranger(octets, type);
}

/* Photo déposée à la main depuis le back-office (base64 envoyé par le navigateur). */
function enregistrerBase64(base64, type) {
  const octets = Buffer.from(String(base64 || ''), 'base64');
  if (!octets.length) throw new Error('Image vide.');
  if (octets.length > TAILLE_MAX) throw new Error('Image trop lourde (plus de 8 Mo).');
  return ranger(octets, type);
}

/* Retire les fichiers que plus aucun plat ne référence. Appelé à la main : une
   suppression automatique se déclencherait tôt ou tard au mauvais moment. */
function nettoyerImages(utilisees) {
  if (!fs.existsSync(DOSSIER)) return { retires: 0 };
  const gardees = new Set((utilisees || []).filter(Boolean).map((u) => path.basename(u)));
  let retires = 0;
  for (const f of fs.readdirSync(DOSSIER)) {
    if (gardees.has(f)) continue;
    fs.unlinkSync(path.join(DOSSIER, f));
    retires++;
  }
  return { retires };
}

module.exports = { telecharger, enregistrerBase64, nettoyerImages, ranger, DOSSIER, URL_PUBLIQUE };
