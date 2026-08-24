/* Jours fériés français — calculés, jamais téléchargés.

   Onze dates par an, dont trois qui dépendent de Pâques. Tout se calcule en
   quelques lignes : aller chercher ça sur une API serait ajouter une dépendance
   réseau, un cache, et une panne possible, pour une information qui n'a pas
   changé depuis 1959. C'est aussi la règle du projet — l'écran doit fonctionner
   quand Internet tombe.

   Les jours fériés servent à deux choses ici :
   - l'agenda, où ils expliquent une semaine creuse ;
   - le planning scolaire, où ils disent qu'il n'y a pas cours. */

/* Dimanche de Pâques — algorithme de Meeus/Jones/Butcher (grégorien).
   Aucune boucle, aucune table : exact pour toute année du calendrier grégorien. */
function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);       // 3 = mars, 4 = avril
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const decale = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* Les onze fériés de France métropolitaine. L'Alsace-Moselle en a deux de plus
   (Vendredi saint, 26 décembre) — sans objet à Roubaix, et volontairement
   omis plutôt qu'affichés à tort. */
function pour(annee) {
  const p = paques(annee);
  return [
    { date: `${annee}-01-01`, nom: 'Jour de l’an' },
    { date: ymd(decale(p, 1)), nom: 'Lundi de Pâques' },
    { date: `${annee}-05-01`, nom: 'Fête du Travail' },
    { date: `${annee}-05-08`, nom: 'Victoire 1945' },
    { date: ymd(decale(p, 39)), nom: 'Ascension' },
    { date: ymd(decale(p, 50)), nom: 'Lundi de Pentecôte' },
    { date: `${annee}-07-14`, nom: 'Fête nationale' },
    { date: `${annee}-08-15`, nom: 'Assomption' },
    { date: `${annee}-11-01`, nom: 'Toussaint' },
    { date: `${annee}-11-11`, nom: 'Armistice 1918' },
    { date: `${annee}-12-25`, nom: 'Noël' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/* Fenêtre couvrant celle de l'agenda (−45 j / +180 j) : deux années suffisent,
   trois quand on est en fin d'année. */
function fenetre(reference = new Date()) {
  const an = reference.getFullYear();
  return [...pour(an - 1), ...pour(an), ...pour(an + 1)];
}

const parDate = (reference) => {
  const t = {};
  for (const f of fenetre(reference)) t[f.date] = f.nom;
  return t;
};

const estFerie = (date, table) => (table || parDate())[typeof date === 'string' ? date : ymd(date)] || '';

module.exports = { paques, pour, fenetre, parDate, estFerie, ymd };
