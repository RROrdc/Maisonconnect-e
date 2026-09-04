'use strict';
/* Petites briques partagées du module école.
 *
 * Elles sont ici et pas dans le client pour la même raison que
 * `recettes/commun.js` : c'est le nettoyage qui fait la qualité du résultat,
 * et il se teste sans réseau. */

/* ── Encodage attendu par EcoleDirecte ────────────────────────────────────
 * L'identifiant et le mot de passe sont insérés dans un JSON construit à la
 * main, lui-même passé en `application/x-www-form-urlencoded`. Le serveur
 * attend très exactement le résultat du `urllib.parse.quote(s, safe="~()*!.'%\")`
 * de Python — ni plus ni moins échappé.
 * ⚠️ `encodeURIComponent` ne suffit PAS : il laisse `$` intact là où Python
 * l'encode. Un mot de passe contenant `$` échouerait avec un code 505
 * (« identifiants incorrects »), qu'on passerait des heures à imputer au
 * mot de passe lui-même. On encode donc caractère par caractère.
 * Le doublement des antislashs, lui, protège le JSON dans lequel on insère.
 * ✅ Éprouvé en vrai : le mot de passe du compte contient « @ » et « & » —
 *    ce dernier aurait coupé le corps de la requête en deux sans cet encodage. */
const SUR = new Set(
  ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~()*!'%" + String.fromCharCode(92)).split(''),
);
function encoderED(valeur) {
  let sortie = '';
  for (const ch of String(valeur)) {
    if (SUR.has(ch)) { sortie += ch; continue; }
    for (const octet of Buffer.from(ch, 'utf8')) sortie += '%' + octet.toString(16).toUpperCase().padStart(2, '0');
  }
  /* Chaque antislash est doublé : la chaîne part dans un littéral JSON. */
  return sortie.split(String.fromCharCode(92)).join(String.fromCharCode(92, 92));
}

/* Le décodage doit être explicitement UTF-8, sinon les accents ressortent en
   mojibake — le projet a déjà payé ce défaut sur le `.env`. */
const deBase64 = (s) => Buffer.from(String(s || ''), 'base64').toString('utf8');
const enBase64 = (s) => Buffer.from(String(s == null ? '' : s), 'utf8').toString('base64');

/* 🐞 EcoleDirecte n'encode PAS tout de la même façon : la question du QCM et le
   contenu d'un devoir sont en base64, le SUJET d'un message ne l'est pas.
   Décoder aveuglément a transformé les quatre messages du lycée en charabia
   binaire. On ne décode donc que si le résultat est lisible.
   ⚠️ Le test doit porter sur le RÉSULTAT, pas sur la forme de l'entrée : un
   sujet court et sans accent ressemble parfaitement à du base64. */
const CONTROLE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
function texteEventuellementBase64(valeur) {
  const brut = String(valeur == null ? '' : valeur);
  if (!brut) return '';
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(brut.trim())) return brut;
  let decode;
  try { decode = Buffer.from(brut, 'base64').toString('utf8'); } catch { return brut; }
  if (!decode || CONTROLE.test(decode)) return brut;
  return decode;
}

/* Les contenus (devoirs, messages) arrivent en HTML : sur un écran mural comme
   à l'oral, on veut du texte. On garde les sauts de ligne portés par les
   balises de bloc, sinon tout se recolle en un pavé illisible — même défaut
   que les recettes d'un seul tenant (§ 2 quinquies). */
function texteDeHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&')            /* en dernier, sinon &amp;lt; se décode deux fois */
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* L'année scolaire au format attendu par l'API : « 2026-2027 ».
   Bascule en août — c'est la convention de l'API elle-même. */
function anneeScolaire(d = new Date()) {
  const a = d.getFullYear();
  return d.getMonth() + 1 >= 8 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

const jour = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dansNJours(n, depuis = new Date()) {
  const d = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

module.exports = {
  encoderED, deBase64, enBase64, texteEventuellementBase64, texteDeHtml,
  anneeScolaire, jour, dansNJours,
};
