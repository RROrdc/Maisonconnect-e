/* Assistant vocal — chemin RAPIDE, sans IA.

   Pourquoi des règles alors qu'on a un modèle juste à côté :
   1. LA LATENCE. « Ajoute du lait aux courses » est la phrase la plus fréquente
      de tout le système. Y répondre en 5 ms plutôt qu'en deux secondes change la
      sensation d'usage — à l'oral, deux secondes de silence donnent l'impression
      que l'appareil n'a pas entendu, et on répète.
   2. LE REPLI. Sans clé API, l'assistant continue de rendre le service courant
      au lieu de ne rien faire du tout.

   Volontairement PEU de motifs, et très serrés. Une règle qui se déclenche à
   tort est pire que pas de règle : elle court-circuite le modèle, qui lui aurait
   compris. Tout le reste part à l'IA. */

/* On ne coupe QUE sur des tournures sans ambiguïté possible. Chaque motif doit
   contenir le verbe ET la destination — « ajoute du lait » seul est ambigu
   (courses ? tâches ?) et part donc à l'IA. */
const MOTIFS = [
  {
    action: 'ajouter_course',
    re: /^(?:ajoute|rajoute|note|mets|met)\s+(.+?)\s+(?:sur|dans|à|a|aux)\s+(?:la\s+)?(?:liste(?:\s+de\s+courses?)?|courses?)\s*$/i,
    champs: (m) => ({ article: nettoyer(m[1]) }),
  },
  {
    /* « courses : lait » — la forme la plus courte, pratique en dictée. */
    action: 'ajouter_course',
    re: /^courses?\s*[:,]\s*(.+)$/i,
    champs: (m) => ({ article: nettoyer(m[1]) }),
  },
  {
    action: 'ajouter_postit',
    re: /^(?:laisse|[ée]cris|note)\s+(?:un\s+)?(?:mot|post[- ]?it|message)\s*[:,]?\s*(.+)$/i,
    champs: (m) => ({ message: nettoyer(m[1], false) }),
  },
];

/* Les articles dictés arrivent avec l'article partitif (« du lait », « des
   œufs ») et parfois une majuscule de dictée. On range la liste de courses, pas
   la transcription. */
function nettoyer(s, retirerPartitif = true) {
  let v = String(s || '').trim().replace(/[.!?]+$/, '');
  if (retirerPartitif) v = v.replace(/^(?:du|de\s+la|de\s+l['’]|des|de|d['’]|un|une|le|la|les)\s+/i, '');
  return v.trim();
}

function comprendre(texte) {
  const t = String(texte || '').trim();
  if (!t) return null;
  for (const m of MOTIFS) {
    const r = m.re.exec(t);
    if (!r) continue;
    const champs = m.champs(r);
    /* Un intitulé vide ou d'un seul caractère vient forcément d'une mauvaise
       transcription : mieux vaut laisser l'IA relire la phrase entière. */
    const valeur = champs.article || champs.message || '';
    if (valeur.length < 2) return null;
    return { action: m.action, ...champs, source: 'regle' };
  }
  return null;
}

module.exports = { comprendre, nettoyer };
