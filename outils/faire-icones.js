/* Génère les icônes PNG de l'app famille.
   Usage :  node outils/faire-icones.js

   Pourquoi maison plutôt qu'une image toute faite : iOS exige un PNG pour
   `apple-touch-icon` (pas de SVG), et le projet doit rester SANS DÉPENDANCE
   et SANS CDN. On dessine donc les pixels à la main et on encode le PNG
   avec `zlib`, qui est dans Node. Aucune bibliothèque graphique.

   Dessin : carré à coins arrondis + maison blanche (toit, corps, porte, cheminée).
   Anti-crénelage par sur-échantillonnage 4×4. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FOND = [0x1b, 0x23, 0x33];     // bleu nuit — se détache sur les fonds d'écran clairs comme sombres
const TRAIT = [0xff, 0xff, 0xff];
const ACCENT = [0xff, 0xb3, 0x40];   // fenêtre allumée : rappelle l'écran de la cuisine

/* --- géométrie, en coordonnées 0..1 --- */
const dansTriangle = (x, y, ax, ay, bx, by, cx, cy) => {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  return a >= 0 && b >= 0 && a + b <= 1;
};
const dansRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
/* carré à coins arrondis, rayon r */
function dansCarreArrondi(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r || (dx === 0 && dy === 0);
}

/* Couleur d'un point, ou null si hors de l'icône (transparent). */
function couleur(x, y) {
  if (!dansCarreArrondi(x, y, 0.22)) return null;
  const toit    = dansTriangle(x, y, 0.50, 0.17, 0.13, 0.50, 0.87, 0.50);
  const corps   = dansRect(x, y, 0.22, 0.48, 0.78, 0.83);
  const cheminee= dansRect(x, y, 0.64, 0.24, 0.72, 0.38);
  const porte   = dansRect(x, y, 0.44, 0.62, 0.56, 0.83);
  const fenetre = dansRect(x, y, 0.28, 0.56, 0.39, 0.67);
  if (porte || fenetre) return fenetre ? ACCENT : FOND;
  if (toit || corps || cheminee) return TRAIT;
  return FOND;
}

function pixels(taille) {
  const S = 4;                                  // sur-échantillonnage
  const buf = Buffer.alloc(taille * taille * 4);
  for (let py = 0; py < taille; py++) {
    for (let px = 0; px < taille; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = couleur((px + (sx + 0.5) / S) / taille, (py + (sy + 0.5) / S) / taille);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
      }
      const n = S * S, i = (py * taille + px) * 4;
      /* on divise par le nombre d'échantillons OPAQUES : sinon les bords arrondis grisent */
      const op = a / 255 || 1;
      buf[i] = r / op; buf[i + 1] = g / op; buf[i + 2] = b / op; buf[i + 3] = a / n;
    }
  }
  return buf;
}

/* --- encodage PNG minimal (RGBA, 8 bits, sans filtre) --- */
function png(taille, rgba) {
  const brut = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0;                                   // filtre « None »
    rgba.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }
  const bloc = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([t, data])) : crc(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0)),
  ]);
}

/* CRC32 (repli si zlib.crc32 n'existe pas sur la version de Node) */
let table;
function crc(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const o of buf) c = table[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const dossier = path.join(__dirname, '..', 'public', 'app', 'icones');
fs.mkdirSync(dossier, { recursive: true });
for (const t of [180, 192, 512]) {                 // 180 = apple-touch-icon, 192/512 = manifeste
  const f = path.join(dossier, `icone-${t}.png`);
  fs.writeFileSync(f, png(t, pixels(t)));
  console.log(`✓ ${f}  (${fs.statSync(f).size} octets)`);
}
