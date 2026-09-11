/* ═══════════════════════════════════════════════════════════════════════════
   Clavier tactile — pour l'écran mural, qui n'a ni clavier ni souris.

   POURQUOI DANS LA PAGE
   `squeekboard` est pourtant installé sur le Raspberry, et Chromium a été lancé
   avec `--enable-wayland-ime`. Essayé le 11/09 : le clavier ne monte pas. Ce
   n'est pas un réglage à trouver — le protocole d'entrée de Wayland et Chromium
   ne s'accordent pas de façon fiable ici.
   Un clavier dans la page, lui, ne dépend d'aucun réglage système, marche
   identiquement sur la dalle, le PC et le téléphone, et se corrige avec le reste
   du projet. C'est le même choix que le pavé numérique de /admin/.

   QUAND IL S'AFFICHE
   Seulement sur un écran tactile SANS clavier natif : `pointer: coarse` exclut
   le PC (souris), et l'exclusion d'iOS/Android évite de doubler un clavier
   système qui, lui, fonctionne très bien. Détecter « suis-je la dalle ? » plus
   finement serait deviner.

   CE QU'IL ÉCRIT
   Il tape DANS le champ et déclenche `input` : le reste de la page se comporte
   exactement comme avec un vrai clavier, sans rien savoir de lui.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const tactile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const natif = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!tactile || natif) return;

  /* AZERTY, parce que c'est ce que la famille connaît. Les accents courants
     sont sur une rangée à part plutôt que derrière un appui long : sur un mur on
     appuie, on n'apprend pas un geste. */
  const RANGEES = [
    'a z e r t y u i o p'.split(' '),
    'q s d f g h j k l m'.split(' '),
    'w x c v b n , . -'.split(' '),
  ];
  const ACCENTS = 'é è ê à ç ù ô î'.split(' ');
  const CHIFFRES = '1 2 3 4 5 6 7 8 9 0'.split(' ');

  let cible = null, majuscule = false, chiffres = false, zone = null;

  const estChamp = (el) => el && (
    (el.tagName === 'INPUT' && /^(text|search|email|tel|url|number|password)$/i.test(el.type || 'text'))
    || el.tagName === 'TEXTAREA');

  function style() {
    if (document.getElementById('clavierCss')) return;
    const s = document.createElement('style');
    s.id = 'clavierCss';
    s.textContent = `
      .clv{position:fixed;left:0;right:0;bottom:0;z-index:100000;
        background:rgba(22,24,28,.97);padding:10px 10px 14px;
        box-shadow:0 -6px 26px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:7px}
      .clv .r{display:flex;gap:7px;justify-content:center}
      .clv button{flex:1 1 0;min-width:0;height:56px;border:0;border-radius:11px;
        background:#3a3f47;color:#fff;font:600 21px/1 system-ui,sans-serif;cursor:pointer}
      .clv button:active{background:#565d68}
      .clv button.w2{flex:2 1 0}
      .clv button.esp{flex:6 1 0}
      .clv button.ok{background:#2f855a}
      .clv button.sec{background:#2a2e34;font-size:16px}
      /* Le champ ne doit jamais passer sous le clavier : sinon on tape à
         l'aveugle, ce qui est pire que pas de clavier du tout. */
      body.clv-ouvert .sheet{max-height:52vh}`;
    document.head.appendChild(s);
  }

  function touche(lib, cls, act) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = lib;
    if (cls) b.className = cls;
    /* `mousedown` plutôt que `click` : on empêche le champ de perdre le focus,
       sinon la première frappe le referme. */
    b.addEventListener('mousedown', (e) => { e.preventDefault(); act(); });
    return b;
  }

  function ecrire(c) {
    if (!cible) return;
    const d = cible.selectionStart, f = cible.selectionEnd;
    const v = cible.value || '';
    if (typeof d === 'number' && typeof f === 'number') {
      cible.value = v.slice(0, d) + c + v.slice(f);
      cible.selectionStart = cible.selectionEnd = d + c.length;
    } else cible.value = v + c;
    cible.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function effacer() {
    if (!cible) return;
    const d = cible.selectionStart, f = cible.selectionEnd, v = cible.value || '';
    if (typeof d === 'number' && d !== f) {
      cible.value = v.slice(0, d) + v.slice(f);
      cible.selectionStart = cible.selectionEnd = d;
    } else if (typeof d === 'number' && d > 0) {
      cible.value = v.slice(0, d - 1) + v.slice(d);
      cible.selectionStart = cible.selectionEnd = d - 1;
    } else cible.value = v.slice(0, -1);
    cible.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* Valider = ce que ferait Entrée. Beaucoup de champs du projet écoutent
     `change` ou `keydown Enter` ; on envoie les deux, puis on ferme. */
  function valider() {
    if (!cible) return;
    const c = cible;
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    c.dispatchEvent(new Event('change', { bubbles: true }));
    fermer();
    c.blur();
  }

  function dessiner() {
    zone.innerHTML = '';
    const lignes = chiffres
      ? [CHIFFRES, '& é " \' ( - è _ ç à'.split(' '), '@ # € % / \\ + = ( )'.split(' ')]
      : RANGEES;
    for (const l of lignes) {
      const r = document.createElement('div');
      r.className = 'r';
      for (const c of l) r.appendChild(touche(majuscule ? c.toUpperCase() : c, '', () => ecrire(majuscule ? c.toUpperCase() : c)));
      zone.appendChild(r);
    }
    if (!chiffres) {
      const ra = document.createElement('div');
      ra.className = 'r';
      for (const c of ACCENTS) ra.appendChild(touche(c, 'sec', () => ecrire(c)));
      zone.appendChild(ra);
    }
    const bas = document.createElement('div');
    bas.className = 'r';
    bas.appendChild(touche(majuscule ? '⇧' : '⇧', 'sec w2', () => { majuscule = !majuscule; dessiner(); }));
    bas.appendChild(touche(chiffres ? 'abc' : '123', 'sec w2', () => { chiffres = !chiffres; dessiner(); }));
    bas.appendChild(touche('espace', 'esp', () => ecrire(' ')));
    bas.appendChild(touche('⌫', 'w2', effacer));
    bas.appendChild(touche('✓', 'ok w2', valider));
    zone.appendChild(bas);
  }

  function ouvrir(el) {
    style();
    cible = el;
    if (!zone) { zone = document.createElement('div'); zone.className = 'clv'; document.body.appendChild(zone); }
    zone.style.display = '';
    document.body.classList.add('clv-ouvert');
    majuscule = false; chiffres = false;
    dessiner();
  }

  function fermer() {
    if (zone) zone.style.display = 'none';
    document.body.classList.remove('clv-ouvert');
    cible = null;
  }

  document.addEventListener('focusin', (e) => { if (estChamp(e.target)) ouvrir(e.target); });
  /* On ne ferme pas sur `focusout` : appuyer sur une touche fait sortir le focus
     une fraction de seconde, et le clavier se refermerait à la première lettre.
     On ferme quand le focus part VERS autre chose qu'un champ. */
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!estChamp(document.activeElement)) fermer(); }, 120);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });
})();
