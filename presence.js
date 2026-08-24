/* Qui est à la maison, et quel jour — garde alternée.

   ── La source de vérité est le CALENDRIER iCloud ────────────────────────────
   Décision de Rémi : « garde-le en lecture, si on doit modifier c'est dans le
   calendrier ». On ne écrit donc JAMAIS dans l'agenda ; on lit des marqueurs
   qu'il y pose déjà à la main, et qui existaient avant ce module :

     « Les enfants »          → week-end de présence d'Augustin et Clovis
     « Vacances enfant … »    → période de vacances chez nous
     « Recup garcons »        → l'heure de récupération (informatif)

   ── Pourquoi PAS un calcul de parité de semaine ─────────────────────────────
   ⚠️ Le relevé de 16 occurrences réelles le prouve : les week-ends tombent en
   semaines PAIRES jusqu'en décembre 2026, puis IMPAIRES dès janvier 2027
   (semaine 52 → semaine 1). Une règle « semaines paires » serait donc fausse à
   partir du Nouvel An, silencieusement. Le rythme réel est de 14 jours depuis
   une date de référence — c'est ce qu'on utilise en repli, jamais la parité.

   ── Qui est là, selon Rémi ──────────────────────────────────────────────────
     Week-end AVEC les garçons  → tout le monde                          = 6
     Week-end SANS les garçons  → Rémi et Amandine seuls                 = 2
     En semaine                 → Rémi, Amandine, Martial, Enora         = 4
     Vacances marquées          → tout le monde                          = 6
     Autres moitiés de vacances → Rémi et Amandine seuls                 = 2

   ── Ce que ce module NE fait pas ────────────────────────────────────────────
   Il ne force aucun nombre de couverts : il PROPOSE. Même règle que les courses
   depuis le menu et les recettes — la machine propose, l'humain décide. */

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const jourDe = (iso) => new Date(iso + 'T12:00:00');
const decale = (iso, n) => { const d = jourDe(iso); d.setDate(d.getDate() + n); return ymd(d); };
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function creerPresence({ donnees, config }) {

  const reglage = (cle, defaut) => {
    const v = config ? config(cle) : '';
    return v === undefined || v === null || v === '' ? defaut : v;
  };

  const decouper = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

  /* Membres du foyer présents en permanence, et enfants en garde alternée.
     Les prénoms sont des RÉGLAGES : ce module doit pouvoir servir à un autre
     foyer sans être réécrit (§ 5 quater — ne rien coder en dur de spécifique). */
  const socle = () => decouper(reglage('garde_socle', 'Rémi, Amandine'));
  const enSemaine = () => decouper(reglage('garde_semaine', 'Enora, Martial'));
  const alternes = () => decouper(reglage('garde_alternes', 'Augustin, Clovis'));

  /* ---------------------------------------------------------------- marqueurs
     Un événement « journée entière » a un DTEND EXCLUSIF : le dernier jour est
     la veille. Se tromper là-dessus décale toute une période d'un jour. */
  function periodesDuCalendrier(agenda) {
    const motifWe = sansAccent(reglage('garde_marqueur_we', 'les enfants'));
    const motifVac = sansAccent(reglage('garde_marqueur_vacances', 'vacances enfant'));
    /* Le marqueur de week-end est souvent posé sur le seul samedi, alors que les
       enfants arrivent le vendredi (« Recup garcons » à 14h30) et repartent le
       dimanche. On étend donc de part et d'autre — c'est une hypothèse, elle est
       affichée dans le back-office pour pouvoir être corrigée. */
    const avant = Number(reglage('garde_we_avant', 1));
    const apres = Number(reglage('garde_we_apres', 1));

    const out = [];
    for (const e of agenda || []) {
      const titre = sansAccent(e.summary);
      const estWe = titre === motifWe || titre.startsWith(motifWe);
      const estVac = titre.includes(motifVac);
      if (!estWe && !estVac) continue;

      /* ⚠️ On prend `jour` / `jourFin`, publiés par le serveur en heure LOCALE.
         Découper la chaîne ISO lit l'UTC : pour un événement de journée entière,
         minuit à Paris tombe la veille à 22 h UTC — la période entière se
         décalait donc d'un jour. Repli sur une conversion locale si les champs
         manquent (enregistrement en cache d'une version antérieure). */
      const debut = e.jour || ymd(new Date(e.start));
      let fin = e.jourFin || (e.fin ? ymd(new Date(e.fin)) : debut);
      if (e.journee && fin > debut) fin = decale(fin, -1);      // DTEND exclusif

      out.push(estWe
        ? { du: decale(debut, -avant), au: decale(fin, apres), type: 'week-end', source: 'calendrier', titre: e.summary }
        : { du: debut, au: fin, type: 'vacances', source: 'calendrier', titre: e.summary });
    }
    return out.sort((a, b) => a.du.localeCompare(b.du));
  }

  /* ------------------------------------------------------- vacances scolaires
     Sans elles, le module se trompait de façon flagrante : en plein mois d'août
     il annonçait « Enora et Martial sont là », alors qu'ils sont chez leurs
     autres parents jusqu'au 30 août.

     Règle donnée par Rémi : « les autres moitiés de vacances, ils sont chez leur
     parent respectif — donc on est à 2 ». Donc, PENDANT une vacance scolaire et
     SANS marqueur de présence dans le calendrier, il n'y a personne.

     ⚠️ Ces dates sont un RÉGLAGE, pas un calcul : elles changent chaque année et
     dépendent de la zone (ici la B). Elles sont éditables dans /admin/, et le
     back-office invite à les vérifier — mieux vaut une date corrigée à la main
     qu'un calcul qui se trompe sans le dire. */
  function vacancesScolaires() {
    return String(reglage('garde_vacances_scolaires', ''))
      .split('\n')
      .map((l) => {
        const m = /(\d{4}-\d{2}-\d{2})\s*(?:→|->|à|a|au)\s*(\d{4}-\d{2}-\d{2})/.exec(l);
        return m ? { du: m[1], au: m[2], libelle: (l.split('#')[1] || '').trim() } : null;
      })
      .filter(Boolean);
  }

  const enVacances = (date) => vacancesScolaires().find((v) => date >= v.du && date <= v.au) || null;

  /* Repli au-delà du calendrier : rythme de 14 jours depuis une référence.
     Sert uniquement à répondre « et dans deux mois ? » quand l'agenda ne va pas
     si loin — le calendrier reste prioritaire dès qu'il dit quelque chose. */
  function periodeDeduite(jour) {
    const ref = reglage('garde_reference', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return null;
    const avant = Number(reglage('garde_we_avant', 1));
    const apres = Number(reglage('garde_we_apres', 1));

    /* Distance en jours à la référence, ramenée au cycle de 14. */
    const ecart = Math.round((jourDe(jour) - jourDe(ref)) / 86400000);
    const dansLeCycle = ((ecart % 14) + 14) % 14;
    /* La référence est un samedi de présence ; la fenêtre couvre
       [-avant, +apres] autour d'elle, donc les derniers jours du cycle aussi. */
    const present = dansLeCycle <= apres || dansLeCycle >= 14 - avant;
    return present ? { type: 'week-end', source: 'rythme déduit (hors calendrier)' } : null;
  }

  /* ---------------------------------------------------------------- présence */
  function pour(jour, agenda) {
    const date = typeof jour === 'string' ? jour.slice(0, 10) : ymd(jour);
    const actif = reglage('garde_actif', '1') === '1';
    const base = socle();
    const semaine = enSemaine();
    const enfants = alternes();

    if (!actif) {
      return { date, presents: [...base, ...semaine, ...enfants], couverts: base.length + semaine.length + enfants.length,
        type: 'garde désactivée', source: 'réglage' };
    }

    /* ⚠️ On raisonne PAR ENFANT, pas globalement. Un premier jet traitait la
       présence comme un mode unique (« les garçons sont là → tout le monde est
       là ») : le week-end du 22 août annonçait alors 6 couverts, alors que
       Martial et Enora sont chez leurs parents tout le mois — seuls les garçons
       viennent ce week-end-là, donc 4. Les deux fratries suivent deux calendriers
       différents, il faut les traiter comme tels. */
    const periodes = periodesDuCalendrier(agenda);
    const dansPeriode = (type) =>
      periodes.find((x) => x.type === type && date >= x.du && date <= x.au) || null;

    const marqueWe = dansPeriode('week-end');
    const marqueVac = dansPeriode('vacances');
    const deduite = (!marqueWe && !marqueVac) ? periodeDeduite(date) : null;
    const vac = enVacances(date);

    const j = jourDe(date).getDay();
    const weekEnd = (j === 6 || j === 0 || j === 5);   // le vendredi soir compte

    /* Filet contre une récurrence oubliée : pendant une vacance scolaire, un
       marqueur de week-end non accompagné d'un marqueur de vacances est ignoré.

       ⚠️ Cette règle compensait à l'origine un BUG de lecture du calendrier (les
       occurrences supprimées dans iCloud n'étaient pas exclues — corrigé le
       20/08). Elle n'est plus indispensable, et elle devient FAUSSE si les
       enfants viennent un week-end isolé pendant des vacances où ils sont sinon
       absents. D'où le réglage, décochable. */
    const filet = reglage('garde_ignorer_we_en_vacances', '1') === '1';
    const marqueUtile = (vac && filet) ? marqueVac : (marqueWe || marqueVac);

    /* Augustin et Clovis : présents UNIQUEMENT quand le calendrier le dit. */
    const garconsLa = !!(marqueUtile || (!vac && deduite));
    const marqueurIgnore = !!(vac && filet && marqueWe && !marqueVac);

    /* Martial et Enora : présents SAUF pendant une vacance scolaire non marquée
       (ils sont alors chez leur autre parent) et sauf le week-end où les garçons
       ne viennent pas — ils partent le même week-end, réponse de Rémi. */
    const semaineLa = vac ? !!marqueVac : (weekEnd ? garconsLa : true);

    const presents = [...base, ...(semaineLa ? semaine : []), ...(garconsLa ? enfants : [])];

    /* On dit d'OÙ vient la réponse : une déduction qu'on ne peut pas relire est
       une déduction qu'on ne peut pas corriger. */
    let type, source;
    if (marqueVac) { type = 'vacances à la maison'; source = 'calendrier'; }
    else if (vac) {
      type = 'vacances chez leurs autres parents';
      source = 'vacances scolaires' + (vac.libelle ? ` (${vac.libelle})` : '')
        /* On le DIT quand un marqueur a été ignoré : sinon on cherche pourquoi
           l'écran contredit le calendrier, alors que c'est voulu. */
        + (marqueurIgnore ? ` — marqueur « ${marqueWe.titre} » ignoré (filet)` : '');
    }
    else if (marqueWe) { type = 'week-end avec les garçons'; source = 'calendrier'; }
    else if (deduite) { type = 'week-end avec les garçons'; source = deduite.source; }
    else if (weekEnd) { type = 'week-end sans les enfants'; source = 'règle'; }
    else { type = 'semaine'; source = 'règle'; }

    return {
      date, jourNom: JOURS[j], presents, couverts: presents.length,
      type, source, titre: (marqueVac || marqueWe || {}).titre || '',
    };
  }

  /* Vue d'ensemble pour le back-office : les prochaines périodes de présence,
     avec leur origine. On montre d'où vient chaque information — un calcul
     qu'on ne peut pas expliquer ne se corrige pas. */
  function prochaines(agenda, combien = 12) {
    const aujourdhui = ymd(new Date());
    return periodesDuCalendrier(agenda)
      .filter((p) => p.au >= aujourdhui)
      .slice(0, combien)
      .map((p) => ({ ...p, jours: Math.round((jourDe(p.au) - jourDe(p.du)) / 86400000) + 1 }));
  }

  /* Couverts PROPOSÉS pour un repas — jamais imposés. */
  const couvertsProposes = (jour, agenda) => pour(jour, agenda).couverts;

  /* Quelles vacances scolaires n'ont PAS encore de marqueur de présence ?
     Sans ce contrôle, une vacance sans marqueur est traitée comme « personne
     n'est là » — ce qui est souvent juste, mais parfois seulement parce que la
     saisie n'a pas encore été faite. La différence compte : dans un cas c'est la
     réalité, dans l'autre c'est un oubli. Autant la montrer. */
  function vacancesSansMarqueur(agenda) {
    const aujourdhui = ymd(new Date());
    const periodes = periodesDuCalendrier(agenda);
    return vacancesScolaires()
      .filter((v) => v.au >= aujourdhui)
      .map((v) => {
        const marque = periodes.find((p) => p.type === 'vacances' && p.du <= v.au && p.au >= v.du);
        return { ...v, marque: marque || null };
      });
  }

  return { pour, prochaines, couvertsProposes, periodesDuCalendrier,
    vacancesScolaires, vacancesSansMarqueur, ymd };
}

module.exports = { creerPresence, JOURS };
