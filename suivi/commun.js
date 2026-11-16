/* Éléments partagés entre la page de suivi (vue par les clients) et le CRM (vu par Fred). */
(function () {
  'use strict';

  var CONFIG = {
    url: 'https://epxagfydakpojkotnfdr.supabase.co',
    // Clé publique : elle est faite pour être visible. Les données sont protégées
    // par les règles de sécurité de la base, pas par cette clé.
    cle: 'sb_publishable_poKEdJgeKUc6GJMqzPXtTQ_HrzUQT14',
    contact: 'fred@fredkopp.com',
    site: 'https://fredkopp.com'
  };

  // Le parcours client. « nom » et « court » servent dans le CRM, « client » et « detail » sur la page de suivi.
  var ETAPES = [
    { n: 1, nom: 'Appel découverte', court: 'Découverte', client: 'Appel découverte', detail: 'Nous faisons connaissance et je cerne votre besoin.' },
    { n: 2, nom: 'Devis signé et acompte', court: 'Devis et acompte', client: 'Devis et acompte', detail: 'Vous signez le devis et réglez l’acompte : le projet démarre.' },
    { n: 3, nom: 'Collecte des contenus', court: 'Contenus', client: 'Vos contenus', detail: 'Vous m’envoyez vos textes, vos photos, votre logo et vos accès.' },
    { n: 4, nom: 'Maquette', court: 'Maquette', client: 'Maquette', detail: 'Je vous montre à quoi ressemblera le résultat. Vous validez.' },
    { n: 5, nom: 'Construction', court: 'Construction', client: 'Construction', detail: 'Je construis votre projet.' },
    { n: 6, nom: 'Relecture client', court: 'Relecture', client: 'Votre relecture', detail: 'Vous relisez, je corrige. Deux tours de corrections sont inclus.' },
    { n: 7, nom: 'Mise en ligne', court: 'Mise en ligne', client: 'Mise en ligne', detail: 'Votre projet est publié à votre adresse.' },
    { n: 8, nom: 'Livraison et solde', court: 'Livraison', client: 'Livraison', detail: 'Je vous montre comment vous en servir, puis vient la facture du solde.' },
    { n: 9, nom: 'Suivi', court: 'Suivi', client: 'Suivi', detail: 'Je reste disponible pour la maintenance et les évolutions.' }
  ];

  /* Fabrique un élément sans jamais interpréter de HTML : tout texte reste du texte. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) ajouter(node, arguments[i]);
    return node;
  }

  function ajouter(node, enfant) {
    if (enfant === null || enfant === undefined || enfant === false) return;
    if (Array.isArray(enfant)) { enfant.forEach(function (e) { ajouter(node, e); }); return; }
    if (typeof enfant === 'string' || typeof enfant === 'number') node.appendChild(document.createTextNode(String(enfant)));
    else node.appendChild(enfant);
  }

  function versDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  var fmtJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  var fmtJourAn = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  /* « 3 nov. », avec l'année seulement quand ce n'est pas l'année en cours. */
  function dateCourte(s) {
    var d = versDate(s);
    if (!d) return '';
    return (d.getFullYear() === new Date().getFullYear() ? fmtJour : fmtJourAn).format(d);
  }

  function borner(etape) {
    return Math.min(9, Math.max(1, Math.round(Number(etape)) || 1));
  }

  function pourcentage(etape, termine) {
    return termine ? 100 : Math.floor(borner(etape) / 9 * 100);
  }

  function minuscule(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  /* La carte de suivi. Avec { apercu: true }, version réduite affichée dans le CRM. */
  function rendreSuivi(d, opts) {
    opts = opts || {};
    var etape = borner(d.etape);
    var termine = !!d.termine;
    var p = pourcentage(etape, termine);
    var prenom = String(d.prenom || '').trim();
    var dates = d.dates_etapes && typeof d.dates_etapes === 'object' ? d.dates_etapes : {};
    var courante = ETAPES[etape - 1];
    var suivante = ETAPES[etape];
    var attenduTitre = String(d.attendu_titre || '').trim();
    var attenduDetail = String(d.attendu_detail || '').trim();

    var jauge = el('i');
    var barre = el('div', {
      class: 'sv-barre', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': String(p), 'aria-label': 'Avancement du projet'
    }, jauge);
    if (opts.apercu) jauge.style.width = p + '%';
    else setTimeout(function () { jauge.style.width = p + '%'; }, 80);

    var bloc = null;
    if (!termine && attenduTitre) {
      var sujet = 'Mon projet : ' + attenduTitre;
      bloc = el('div', { class: 'sv-attendu' },
        el('p', { class: 'sur' }, 'Ce que j’attends de vous'),
        el('p', { class: 'sv-quoi' }, attenduTitre),
        attenduDetail ? el('p', { class: 'sv-detail' }, attenduDetail) : null,
        opts.apercu
          ? el('span', { class: 'btn sv-faux' }, 'Répondre à Fred')
          : el('a', { class: 'btn', href: 'mailto:' + CONFIG.contact + '?subject=' + encodeURIComponent(sujet) }, 'Répondre à Fred')
      );
    } else if (!termine) {
      bloc = el('p', { class: 'sv-calme' }, 'Rien à faire de votre côté pour l’instant : c’est à moi de jouer.');
    }

    var carte = el('section', { class: 'sv-carte' },
      el('p', { class: 'sv-logo', 'aria-hidden': 'true' }, 'FRED', el('br'), 'KOPP'),
      el(opts.apercu ? 'p' : 'h1', { class: 'sv-titre' },
        termine ? 'Votre projet est terminé' : 'Votre projet avance',
        prenom ? [', ', el('em', null, prenom)] : null, '.'),
      el('div', null,
        el('p', { class: 'sv-ligne' },
          el('span', null, termine ? 'Les 9 étapes sont faites' : 'Étape ' + etape + ' sur 9'),
          el('strong', null, p + ' %')),
        barre,
        el('p', { class: 'sv-moment' }, termine ? 'Merci pour votre confiance.' : 'En ce moment : ' + minuscule(courante.client))
      ),
      bloc,
      !termine && suivante ? el('p', { class: 'sv-suite' }, 'Prochaine étape : ' + minuscule(suivante.client) + '.') : null
    );

    if (opts.apercu) return carte;

    var liste = el('ol', { class: 'sv-etapes' }, ETAPES.map(function (e) {
      var fait = termine || e.n < etape;
      var cours = !termine && e.n === etape;
      var quand = fait && dates[e.n] ? dateCourte(dates[e.n]) : '';
      return el('li', { class: 'sv-etape' + (fait ? ' sv-etape--fait' : cours ? ' sv-etape--cours' : ' sv-etape--venir') },
        el('span', { class: 'pt ' + (fait ? 'pt--fait' : cours ? 'pt--cours' : 'pt--venir'), 'aria-hidden': 'true' }, fait ? '✓' : String(e.n)),
        el('div', null,
          el('p', { class: 'tn' }, e.client,
            el('span', { class: 'sv-etat' }, fait ? ' · fait' + (quand ? ' le ' + quand : '') : cours ? ' · en cours' : '')),
          el('p', { class: 'nv' }, e.detail)
        )
      );
    }));

    return el('div', { class: 'sv-contenu' },
      carte,
      el('section', { class: 'sv-chemin' },
        el('h2', { class: 'sur' }, 'Le chemin' + (d.projet ? ' · ' + d.projet : '')),
        liste),
      el('p', { class: 'sv-pied' }, 'Une question ? Écrivez-moi : ',
        el('a', { href: 'mailto:' + CONFIG.contact }, CONFIG.contact))
    );
  }

  window.FK = {
    CONFIG: CONFIG,
    ETAPES: ETAPES,
    el: el,
    versDate: versDate,
    dateCourte: dateCourte,
    pourcentage: pourcentage,
    rendreSuivi: rendreSuivi
  };
})();
