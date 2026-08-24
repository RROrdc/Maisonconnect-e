/* Voix — moteur partagé entre l'écran mural (`bento.html`) et le banc d'essai
   (`vocal.html`).

   Pourquoi un fichier commun plutôt qu'un copier-coller : la mécanique tient en
   trois étages (reconnaissance, envoi, synthèse) et chacun cache un piège de
   navigateur. Deux copies auraient divergé au premier correctif — c'est déjà
   arrivé sur ce projet avec les rayons de courses, codés en dur des deux côtés
   avec des valeurs différentes, et des articles devenus invisibles sur le mur.

   Ce module ne connaît AUCUNE interface : il appelle des fonctions qu'on lui
   donne. C'est ce qui lui permet de servir une page de diagnostic bavarde et un
   écran mural silencieux sans une ligne de différence.

   ⚠️ Les trois pièges déjà payés, tous corrigés ici :
   1. Le micro exige un CONTEXTE SÉCURISÉ (HTTPS ou localhost). Sur une tablette
      en `http://192.168.x.x`, il ne s'ouvrira pas — c'est une règle du
      navigateur, pas un réglage.
   2. Chrome ARRÊTE la reconnaissance après un silence, même en mode continu :
      sans relance, l'écoute meurt sans prévenir au bout d'une minute.
   3. On coupe le micro pendant que l'assistant parle (sinon il s'entend et se
      répond) et on le reprend sur la fin de parole — événement qui ne vient
      JAMAIS si la synthèse échoue en silence, ce que Chrome sait faire. D'où une
      reprise programmée en filet. */
(function (global) {
  'use strict';

  const Reco = global.SpeechRecognition || global.webkitSpeechRecognition;

  /* « Jarvis » n'est pas un mot français : la transcription en donne souvent une
     approximation phonétique. On accepte les variantes plausibles. */
  const EVEILS = ['jarvis', 'jarvisse', 'jarvice', 'jarvi', 'jervis', 'charvis', 'djarvis', 'harvis', 'garvis'];

  const sansAccent = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  /* Le mot d'éveil est configurable. Pour « jarvis » on connaît les
     approximations que produit la transcription ; pour un autre mot on n'en sait
     rien, on s'en tient donc au mot exact plutôt que d'inventer des variantes
     qui déclencheraient à tort. */
  const variantes = (mot) => {
    const m = sansAccent(mot).trim();
    if (!m) return EVEILS;
    return m === 'jarvis' ? EVEILS : [m];
  };

  function disponible() {
    return {
      securise: !!global.isSecureContext,
      reconnaissance: !!Reco,
      synthese: 'speechSynthesis' in global,
      /* La seule combinaison qui permet de PARLER à la maison. */
      utilisable: !!global.isSecureContext && !!Reco,
    };
  }

  function creer(options) {
    const o = Object.assign({
      motEveil: 'jarvis',
      exigerEveil: true,
      langue: 'fr-FR',
      url: '/api/vocal',
      jeton: '',
      delaiMax: 45000,
      sur: {},
    }, options || {});

    const dire2 = (nom, ...a) => { try { if (o.sur[nom]) o.sur[nom](...a); } catch (_) {} };

    let reco = null, ecoute = false, continu = false, arretVoulu = false;
    let enCours = false, repriseTimer = null, voix = null;
    let parle = true;
    /* Nom de voix SOUHAITÉ, mémorisé à part. Chrome charge ses voix en différé :
       quand `onvoiceschanged` finit par se déclencher, il faut re-chercher le
       nom COURANT, pas celui passé à la création — sinon un changement de voix
       fait depuis /admin/ était systématiquement écrasé par l'ancien. */
    let voixSouhaitee = o.voix || '';

    /* ------------------------------------------------------------ synthèse */
    function choisirVoix(prefere) {
      if (!('speechSynthesis' in global)) return null;
      const toutes = global.speechSynthesis.getVoices();
      if (prefere) {
        /* Par identifiant d'abord (choix fait sur CETTE machine), puis par NOM :
           la liste des voix change d'un appareil à l'autre, et un identifiant
           choisi sur le PC n'existera pas sur le Raspberry. Le nom, lui, se
           retrouve souvent — et à défaut on retombe sur la meilleure voix
           française plutôt que sur rien. */
        const v = toutes.find((x) => x.voiceURI === prefere)
          || toutes.find((x) => x.name === prefere)
          || toutes.find((x) => x.name.toLowerCase().includes(String(prefere).toLowerCase()));
        if (v) return (voix = v);
      }
      const fr = toutes.filter((x) => /^fr/i.test(x.lang));
      /* Une voix LOCALE évite un aller-retour réseau et continue de fonctionner
         hors ligne — ce qui compte pour un écran de cuisine. */
      voix = fr.find((x) => x.localService) || fr[0] || toutes[0] || null;
      return voix;
    }
    if ('speechSynthesis' in global) {
      choisirVoix(voixSouhaitee);
      /* Chrome charge ses voix en différé : la première lecture rend un tableau
         vide. On relit alors le nom COURANT, pas celui du démarrage. */
      global.speechSynthesis.onvoiceschanged = () => choisirVoix(voixSouhaitee);
    }

    function armerReprise(delai) {
      clearTimeout(repriseTimer);
      repriseTimer = setTimeout(() => { if (continu && !ecoute) demarrer(); }, delai);
    }

    function dire(texte) {
      if (!parle || !('speechSynthesis' in global) || !texte) return;
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = o.langue;
      if (voix) u.voice = voix;
      u.rate = o.debit || 1;
      u.pitch = o.ton || 1;
      u.onstart = () => {
        dire2('trace', 'voix', 'parle');
        if (continu) { arreter(); armerReprise(Math.max(4000, texte.length * 90)); }
      };
      u.onend = () => { dire2('trace', 'voix', 'fin'); if (continu) armerReprise(350); };
      u.onerror = (e) => { dire2('trace', 'voix', 'erreur ' + (e.error || '')); if (continu) armerReprise(350); };

      /* `cancel()` suivi immédiatement de `speak()` perd l'énoncé, et la file de
         synthèse se met parfois en pause d'elle-même : on laisse un souffle, et
         `resume()` ne coûte rien quand tout va bien. */
      try { global.speechSynthesis.cancel(); } catch (_) {}
      setTimeout(() => {
        try { global.speechSynthesis.resume(); global.speechSynthesis.speak(u); }
        catch (e) { dire2('trace', 'voix', 'impossible ' + e.message); }
      }, 80);
    }

    /* ------------------------------------------------------------ envoi */
    async function envoyer(texte) {
      if (enCours || !texte) return;
      enCours = true;
      dire2('envoi', texte);
      const stop = new AbortController();
      const coupe = setTimeout(() => stop.abort(), o.delaiMax);
      try {
        const r = await fetch(o.url, {
          method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json' }, o.jeton ? { 'x-jeton': o.jeton } : {}),
          body: JSON.stringify({ texte }),
          signal: stop.signal,
        });
        const d = await r.json().catch(() => ({}));
        const reponse = d.reponse || d.error || "Je n'ai pas compris.";
        dire2('repondu', Object.assign({}, d, { texte, reponse }));
        dire(reponse);
      } catch (e) {
        const msg = e && e.name === 'AbortError'
          ? 'Pas de réponse du serveur.' : 'Serveur injoignable.';
        dire2('erreur', msg);
        dire(msg);
      } finally { clearTimeout(coupe); enCours = false; }
    }

    /* ------------------------------------------------------------ écoute */
    function traiter(phrase) {
      /* Sans mot d'éveil exigé (appui sur « Parler », ou éveil désactivé), toute
         phrase finale EST une commande : on la marque comme telle, sinon une
         interface qui n'affiche que les phrases « éveillées » resterait muette. */
      if (!continu || !o.exigerEveil) { dire2('entendu', phrase, { eveil: true, sansEveil: true }); return envoyer(phrase); }

      const brut = sansAccent(phrase);
      let i = -1, longueur = 0;
      for (const mot of variantes(o.motEveil)) {
        const p = brut.indexOf(mot);
        if (p >= 0 && (i < 0 || p < i)) { i = p; longueur = mot.length; }
      }
      /* Ignorer en SILENCE était le vrai défaut de la première version : le micro
         pulsait, la phrase partait à la poubelle, et rien ne disait pourquoi. */
      if (i < 0) { dire2('entendu', phrase, { ignore: true }); return; }

      const commande = phrase.slice(i + longueur).replace(/^[\s,.:;!?]+/, '').trim();
      dire2('entendu', phrase, { eveil: true });
      if (commande.length < 2) { dire('Oui ?'); return; }
      envoyer(commande);
    }

    function creerReco() {
      const r = new Reco();
      r.lang = o.langue;
      r.interimResults = true;
      r.continuous = continu;
      r.maxAlternatives = 1;

      r.onstart = () => { ecoute = true; dire2('etat', etat()); dire2('trace', 'micro', 'ouvert'); };
      r.onerror = (e) => {
        dire2('trace', 'micro', 'erreur ' + e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          continu = false;
          dire2('erreur', 'Micro refusé. Autorise le microphone pour ce site.');
        } else if (e.error === 'no-speech') dire2('silence');
      };
      r.onend = () => {
        ecoute = false; dire2('etat', etat());
        /* Chrome arrête tout seul après un silence, même en continu. */
        if (continu && !arretVoulu) setTimeout(demarrer, 250);
      };
      r.onresult = (ev) => {
        let fini = '', provisoire = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) fini += t; else provisoire += t;
        }
        if (provisoire && !fini) dire2('entendu', provisoire, { provisoire: true });
        if (fini) traiter(fini.trim());
      };
      return r;
    }

    function demarrer() {
      if (!Reco || ecoute) return;
      arretVoulu = false;
      try { reco = creerReco(); reco.start(); }
      catch (e) { dire2('erreur', 'Micro indisponible : ' + e.message); }
    }
    function arreter() {
      arretVoulu = true;
      try { if (reco) reco.stop(); } catch (_) {}
      ecoute = false; dire2('etat', etat());
    }
    function basculerContinu(actif) {
      continu = actif === undefined ? !continu : !!actif;
      arreter();
      if (continu) setTimeout(demarrer, 300);
      dire2('etat', etat());
      return continu;
    }
    const etat = () => ({ ecoute, continu, parle, voix: voix ? voix.name : '' });

    return {
      demarrer, arreter, basculerContinu, dire, etat, envoyer,
      choisirVoix,
      /* Applique d'un coup les réglages venus du back-office. */
      reglerVoix(r) {
        if (!r) return;
        if (r.debit) o.debit = Number(r.debit) || 1;
        if (r.ton) o.ton = Number(r.ton) || 1;
        if (r.eveil) o.motEveil = String(r.eveil).trim().toLowerCase();
        if (r.exigerEveil !== undefined) o.exigerEveil = !!r.exigerEveil;
        const nom = r.nom !== undefined ? r.nom : r.voix;
        if (nom !== undefined) { voixSouhaitee = nom || ''; choisirVoix(voixSouhaitee); }
      },
      /* Quelle voix parle réellement — pour qu'un écart entre le réglage et le
         résultat se constate au lieu de se deviner. */
      voixActuelle() { return voix ? { nom: voix.name, lang: voix.lang, locale: voix.localService } : null; },
      voixSouhaitee() { return voixSouhaitee; },
      listeVoix() { return ('speechSynthesis' in global) ? global.speechSynthesis.getVoices() : []; },
      couperVoix(actif) { parle = actif === undefined ? !parle : !!actif; if (!parle) { try { global.speechSynthesis.cancel(); } catch (_) {} } return parle; },
      exigerEveil(actif) { o.exigerEveil = actif === undefined ? !o.exigerEveil : !!actif; return o.exigerEveil; },
      get motEveil() { return o.motEveil; },
    };
  }

  global.Voix = { disponible, creer, EVEILS };
}(window));
