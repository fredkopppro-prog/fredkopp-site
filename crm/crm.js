/* CRM Fred Kopp : tableau des clients, fiche client, suivi de l'argent et des étapes. */
(function () {
  'use strict';

  var FK = window.FK, el = FK.el, ETAPES = FK.ETAPES;
  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ */
  /* Connexion à la base                                                 */
  /* ------------------------------------------------------------------ */

  // À lire avant que la bibliothèque ne nettoie l'adresse : un lien reçu par
  // e-mail (invitation ou mot de passe oublié) mène au choix du mot de passe.
  var hashArrivee = location.hash || '';
  var lienMdp = /[#&]type=(recovery|invite)\b/.test(hashArrivee);
  var lienErreur = /[#&]error(_code|_description)?=/.test(hashArrivee);

  var sb = window.supabase.createClient(FK.CONFIG.url, FK.CONFIG.cle, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'fk-crm' }
  });

  var SELECTION = '*, client:clients(*)';
  var SEUIL = 7; // nombre de jours d'attente à partir duquel on passe « à relancer »

  var etat = { uid: null, email: '', projets: [], archives: false, pret: false, entree: false };

  /* ------------------------------------------------------------------ */
  /* Petits outils                                                       */
  /* ------------------------------------------------------------------ */

  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function aujourdhui() { return iso(new Date()); }
  function jours(s) {
    var d = FK.versDate(s);
    if (!d) return 0;
    return Math.max(0, Math.round((FK.versDate(aujourdhui()) - d) / 864e5));
  }
  function pluriel(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }

  var fmt0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  var fmt2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function euros(n) {
    n = Number(n) || 0;
    return (Math.round(n) === n ? fmt0 : fmt2).format(n) + ' €';
  }

  function nomClient(c) {
    c = c || {};
    var n = ((c.prenom || '') + ' ' + (c.nom || '')).trim();
    return n || (c.entreprise || '').trim() || 'Sans nom';
  }
  function prenomDe(c) { return ((c || {}).prenom || '').trim() || nomClient(c); }

  function trouver(id) {
    for (var i = 0; i < etat.projets.length; i++) if (etat.projets[i].id === id) return etat.projets[i];
    return null;
  }

  function lisible(erreur) {
    var m = (erreur && erreur.message) || '';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion à la base. Vérifiez votre réseau.';
    if (/JWT|token|session/i.test(m)) return 'Session expirée. Reconnectez-vous.';
    if (/check constraint|violates/i.test(m)) return 'Une valeur est refusée par la base (texte trop long ou montant incohérent).';
    return m ? 'Détail : ' + m : '';
  }

  var minuteur = null;
  function toast(texte) {
    var t = $('toast');
    t.textContent = texte;
    t.hidden = false;
    clearTimeout(minuteur);
    minuteur = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function montrer(id) {
    ['chargement', 'ecran-connexion', 'ecran-mdp', 'ecran-refus', 'app'].forEach(function (x) { $(x).hidden = x !== id; });
  }

  function afficher(noeud, texte) {
    noeud.textContent = texte || '';
    noeud.hidden = !texte;
  }

  function confirmer(titre, texte, bouton) {
    return new Promise(function (resoudre) {
      var d = $('dlg-confirme');
      $('cf-titre').textContent = titre;
      $('cf-texte').textContent = texte;
      $('cf-oui').textContent = bouton;
      function finir(reponse) {
        $('cf-oui').onclick = $('cf-non').onclick = d.oncancel = null;
        if (d.open) d.close();
        resoudre(reponse);
      }
      $('cf-oui').onclick = function () { finir(true); };
      $('cf-non').onclick = function () { finir(false); };
      d.oncancel = function () { finir(false); };
      d.showModal();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Lecture d'un projet : où il en est, ce qui est dû, ce qui bloque     */
  /* ------------------------------------------------------------------ */

  function infos(p) {
    var montant = Number(p.montant) || 0;
    var acompte = Math.min(Number(p.acompte) || 0, montant);
    var solde = Math.max(0, montant - acompte);
    var signe = !!p.devis_signe_le;
    var acompteRegle = acompte === 0 || !!p.acompte_verse_le;
    var soldeRegle = solde === 0 || !!p.solde_verse_le;
    return {
      montant: montant,
      acompte: acompte,
      solde: solde,
      signe: signe,
      acompteDu: !p.perdu && signe && !acompteRegle,
      soldeDu: !p.perdu && !soldeRegle && !!p.solde_facture_le,
      archive: !!p.perdu || (!!p.termine && signe && acompteRegle && soldeRegle),
      pct: FK.pourcentage(p.etape, p.termine)
    };
  }

  function attente(n, libelleCourt, libelleLong, relance) {
    var tard = n >= SEUIL;
    return { ton: tard ? 'ret' : 'att', texte: (tard && libelleLong ? libelleLong : libelleCourt) + ' · ' + n + ' j', jours: n, relance: relance };
  }

  /* La liste de ce qui bloque, le plus urgent d'abord. */
  function blocages(p) {
    var i = infos(p), liste = [];
    if (p.perdu) return [{ ton: 'nv', texte: 'Perdu' }];
    if (!i.signe) {
      if (p.devis_envoye_le) liste.push(attente(jours(p.devis_envoye_le), 'Devis envoyé', 'Sans réponse', 'devis'));
      else liste.push({ ton: 'nv', texte: 'Devis à envoyer' });
    }
    if (i.acompteDu) liste.push(attente(jours(p.devis_signe_le), 'Acompte', '', 'acompte'));
    if (!p.termine && (p.attendu_titre || '').trim()) liste.push(attente(jours(p.attendu_depuis), p.attendu_titre.trim(), '', 'attendu'));
    if (i.soldeDu) liste.push(attente(jours(p.solde_facture_le), 'Solde', '', 'solde'));
    if (!liste.length) liste.push({ ton: 'nv', texte: i.archive ? 'Terminé et réglé' : 'Rien, c’est à moi' });
    var rang = { ret: 0, att: 1, nv: 2 };
    return liste.sort(function (a, b) { return rang[a.ton] - rang[b.ton] || (b.jours || 0) - (a.jours || 0); });
  }

  function pastille(ton, texte, long) {
    if (ton === 'nv') return el('span', { class: 'nv' }, texte);
    return el('span', { class: 'p p--' + ton + (long ? ' p--long' : '') }, texte);
  }

  function lienSuivi(p) { return FK.CONFIG.site + '/suivi/#' + p.jeton; }

  /* Un e-mail prérempli, qui s'ouvre dans la messagerie de Fred. Rien ne part tout seul. */
  function courrier(p, type) {
    var c = p.client || {}, i = infos(p);
    var bonjour = 'Bonjour' + ((c.prenom || '').trim() ? ' ' + c.prenom.trim() : '') + ',\n\n';
    var fin = '\n\nBonne journée,\nFred';
    var sujet = 'Votre projet', corps = '';
    if (type === 'devis') {
      sujet = 'Votre devis';
      corps = 'Je reviens vers vous au sujet du devis envoyé le ' + FK.dateCourte(p.devis_envoye_le)
        + '. Avez-vous des questions, ou un point à ajuster ? Je suis disponible pour en parler.';
    } else if (type === 'acompte') {
      sujet = 'Le démarrage de votre projet';
      corps = 'Merci pour votre signature. Pour démarrer, il me manque l’acompte de ' + euros(i.acompte)
        + '. Dès réception, je lance le projet.';
    } else if (type === 'solde') {
      sujet = 'Le solde de votre projet';
      corps = 'Votre projet est livré. Il reste le solde de ' + euros(i.solde) + ', facturé le '
        + FK.dateCourte(p.solde_facture_le) + '. Merci d’avance pour votre règlement.';
    } else if (type === 'attendu') {
      sujet = 'Votre projet : j’ai besoin de vous';
      corps = 'Pour continuer, il me manque : ' + p.attendu_titre.trim() + '.'
        + ((p.attendu_detail || '').trim() ? '\n' + p.attendu_detail.trim() : '')
        + '\n\nVous pouvez suivre l’avancement ici : ' + lienSuivi(p);
    }
    var adresse = encodeURIComponent((c.email || '').trim()).replace(/%40/g, '@');
    return 'mailto:' + adresse + '?subject=' + encodeURIComponent(sujet) + '&body=' + encodeURIComponent(bonjour + corps + fin);
  }

  /* ------------------------------------------------------------------ */
  /* Échanges avec la base                                               */
  /* ------------------------------------------------------------------ */

  async function charger() {
    var r = await sb.from('projets').select(SELECTION).order('created_at', { ascending: false });
    if (r.error) throw r.error;
    etat.projets = r.data || [];
  }

  async function majProjet(id, modif, message) {
    var r = await sb.from('projets').update(modif).eq('id', id).select(SELECTION).single();
    if (r.error) { toast('Enregistrement impossible. ' + lisible(r.error)); return false; }
    etat.projets = etat.projets.map(function (p) { return p.id === id ? r.data : p; });
    route();
    if (message) toast(message);
    return true;
  }

  function nouveauJeton(prenom) {
    var base = String(prenom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');
    var alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 signes, sans l ni o ni 0 ni 1
    var octets = crypto.getRandomValues(new Uint8Array(20));
    var code = Array.prototype.map.call(octets, function (b) { return alphabet[b & 31]; }).join('');
    return (base ? base + '-' : '') + code;
  }

  /* ------------------------------------------------------------------ */
  /* Actions sur un projet                                               */
  /* ------------------------------------------------------------------ */

  function avancer(p) {
    var dates = Object.assign({}, p.dates_etapes || {});
    dates[p.etape] = aujourdhui();
    var modif = { dates_etapes: dates, attendu_titre: '', attendu_detail: '', attendu_depuis: null };
    if (p.etape < 9) { modif.etape = p.etape + 1; modif.etape_depuis = aujourdhui(); }
    else modif.termine = true;
    return majProjet(p.id, modif, p.etape < 9 ? 'Étape ' + p.etape + ' terminée.' : 'Projet terminé.');
  }

  function reculer(p) {
    var dates = Object.assign({}, p.dates_etapes || {});
    var modif;
    if (p.termine) { delete dates[9]; modif = { termine: false, dates_etapes: dates }; }
    else if (p.etape > 1) {
      delete dates[p.etape - 1];
      modif = { etape: p.etape - 1, etape_depuis: aujourdhui(), dates_etapes: dates };
    } else return Promise.resolve(false);
    return majProjet(p.id, modif, p.termine ? 'Projet rouvert.' : 'Retour à l’étape ' + (p.etape - 1) + '.');
  }

  async function supprimer(p) {
    var c = p.client || {};
    var autres = etat.projets.filter(function (x) { return x.client_id === p.client_id && x.id !== p.id; });
    var ok = await confirmer(
      'Supprimer ce projet ?',
      autres.length
        ? '« ' + p.titre + ' » sera effacé. ' + nomClient(c) + ' reste dans vos clients avec ses autres projets. C’est définitif.'
        : nomClient(c) + ' et son projet « ' + p.titre + ' » seront effacés, avec le lien de suivi. C’est définitif.',
      'Supprimer');
    if (!ok) return;
    var r = autres.length
      ? await sb.from('projets').delete().eq('id', p.id)
      : await sb.from('clients').delete().eq('id', p.client_id);
    if (r.error) { toast('Suppression impossible. ' + lisible(r.error)); return; }
    etat.projets = etat.projets.filter(function (x) { return x.id !== p.id; });
    location.hash = '#/';
    route();
    toast('Supprimé.');
  }

  /* ------------------------------------------------------------------ */
  /* Vue A : le tableau                                                  */
  /* ------------------------------------------------------------------ */

  function chiffres() {
    var an = new Date().getFullYear();
    var c = { aEncaisser: 0, nAcomptes: 0, nSoldes: 0, encaisse: 0, nPaiements: 0, bloques: [], devis: [], an: an };
    etat.projets.forEach(function (p) {
      var i = infos(p), d;
      if (i.acompteDu) { c.aEncaisser += i.acompte; c.nAcomptes++; }
      if (i.soldeDu) { c.aEncaisser += i.solde; c.nSoldes++; }
      d = FK.versDate(p.acompte_verse_le);
      if (d && i.acompte > 0 && d.getFullYear() === an) { c.encaisse += i.acompte; c.nPaiements++; }
      d = FK.versDate(p.solde_verse_le);
      if (d && i.solde > 0 && d.getFullYear() === an) { c.encaisse += i.solde; c.nPaiements++; }
      if (!p.perdu && !p.termine && (p.attendu_titre || '').trim() && jours(p.attendu_depuis) >= SEUIL) c.bloques.push(p);
      if (!p.perdu && !i.signe && p.devis_envoye_le) c.devis.push(p);
    });
    c.bloques.sort(function (a, b) { return jours(b.attendu_depuis) - jours(a.attendu_depuis); });
    return c;
  }

  function carteChiffre(titre, valeur, detail) {
    return el('div', { class: 'chiffre' }, el('p', { class: 'sur' }, titre), el('strong', null, valeur), el('span', null, detail));
  }

  function ligneTableau(p) {
    var c = p.client || {}, i = infos(p), b = blocages(p)[0];

    var signe = i.signe ? pastille('ok', '✓ ' + FK.dateCourte(p.devis_signe_le))
      : p.perdu ? pastille('nv', 'Perdu')
      : p.devis_envoye_le ? pastille('att', 'Envoyé le ' + FK.dateCourte(p.devis_envoye_le))
      : pastille('nv', 'À envoyer');

    var acompte = i.acompte === 0 || !i.signe ? pastille('nv', '—')
      : p.acompte_verse_le ? pastille('ok', '✓ ' + euros(i.acompte) + ' versé')
      : pastille('att', euros(i.acompte) + ' en attente');

    var solde = i.solde === 0 || !i.signe ? pastille('nv', '—')
      : p.solde_verse_le ? pastille('ok', '✓ ' + euros(i.solde) + ' versé')
      : p.solde_facture_le ? pastille('att', euros(i.solde) + ' facturé')
      : pastille('nv', euros(i.solde) + ' à la livraison');

    var jauge = el('i');
    jauge.style.width = i.pct + '%';
    var adresse = '#/client/' + p.id;

    return el('tr', { class: i.archive ? 'archive' : null, onclick: function (ev) { if (!ev.target.closest('a')) location.hash = adresse; } },
      el('td', null,
        el('a', { class: 'nomc', href: adresse }, nomClient(c)),
        el('div', { class: 'nv' }, p.titre || 'Projet')),
      el('td', { class: 'montant' }, euros(i.montant)),
      el('td', null, signe),
      el('td', null, acompte),
      el('td', null, solde),
      el('td', null,
        el('div', { class: 'jauge' }, jauge),
        el('div', { class: 'nv' }, p.termine ? 'Terminé' : p.etape + '/9 · ' + ETAPES[p.etape - 1].court)),
      el('td', { class: 'col-bloque' }, pastille(b.ton, b.texte, true))
    );
  }

  function vueTableau() {
    var c = chiffres();
    var actifs = etat.projets.filter(function (p) { return !infos(p).archive; });
    var anciens = etat.projets.filter(function (p) { return infos(p).archive; });
    var lignes = etat.archives ? actifs.concat(anciens) : actifs;

    var jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

    var parts = [];
    if (c.nAcomptes) parts.push(pluriel(c.nAcomptes, 'acompte', 'acomptes'));
    if (c.nSoldes) parts.push(pluriel(c.nSoldes, 'solde', 'soldes'));

    var premier = c.bloques[0];
    var totalDevis = c.devis.reduce(function (s, p) { return s + infos(p).montant; }, 0);

    var contenu;
    if (!etat.projets.length) {
      contenu = el('div', { class: 'vide' },
        el('p', { class: 'tn' }, 'Aucun client pour l’instant.'),
        el('p', null, 'Ajoutez votre premier client : son devis, ses étapes et son lien de suivi se créent en même temps.'),
        el('button', { class: 'btn', type: 'button', onclick: function () { ouvrirFormulaire('nouveau'); } }, 'Ajouter un client'));
    } else if (!lignes.length) {
      contenu = el('div', { class: 'vide' },
        el('p', { class: 'tn' }, 'Aucun projet en cours.'),
        el('p', null, 'Tous vos projets sont terminés et réglés, ou perdus.'));
    } else {
      contenu = el('div', { class: 'boite-table' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null,
            ['Client', 'Devis', 'Signé', 'Acompte', 'Solde', 'Avancement', 'Ce qui bloque'].map(function (t) { return el('th', { scope: 'col' }, t); }))),
          el('tbody', null, lignes.map(ligneTableau))));
    }

    var bascule = anciens.length
      ? el('button', { class: 'lien lien--gris', type: 'button', onclick: function () { etat.archives = !etat.archives; vueTableau(); } },
          etat.archives ? 'Masquer les projets terminés ou perdus' : 'Voir aussi les ' + pluriel(anciens.length, 'projet terminé ou perdu', 'projets terminés ou perdus'))
      : null;

    $('nav-clients').className = 'actif';
    document.title = 'Clients · Fred Kopp';
    $('vue').replaceChildren(el('div', { class: 'page' },
      el('div', null,
        el('p', { class: 'sur' }, jour),
        el('h1', { class: 'titre' }, 'Où en sont ', el('em', null, 'vos'), ' clients.')),
      el('div', { class: 'chiffres' },
        carteChiffre('À encaisser', euros(c.aEncaisser), parts.length ? parts.join(', ') : 'Rien en attente'),
        carteChiffre('Bloqué côté client', String(c.bloques.length),
          premier ? nomClient(premier.client) + ', depuis ' + pluriel(jours(premier.attendu_depuis), 'jour', 'jours') : 'Personne ne vous fait attendre'),
        carteChiffre('Devis sans réponse', String(c.devis.length),
          c.devis.length === 1 ? nomClient(c.devis[0].client) + ', ' + euros(totalDevis)
            : c.devis.length ? euros(totalDevis) + ' en attente' : 'Aucun devis en attente'),
        carteChiffre('Encaissé en ' + c.an, euros(c.encaisse),
          c.nPaiements ? pluriel(c.nPaiements, 'paiement reçu', 'paiements reçus') : 'Aucun paiement pour l’instant')),
      contenu,
      el('div', { class: 'legende' },
        pastille('ok', '✓ Fait'), pastille('att', 'En attente'), pastille('ret', 'À relancer'),
        el('span', null, 'À relancer : en attente depuis ' + SEUIL + ' jours ou plus.'),
        bascule)
    ));
  }

  /* ------------------------------------------------------------------ */
  /* Vue C : la fiche d'un client                                        */
  /* ------------------------------------------------------------------ */

  function bouton(texte, action, classe) {
    return el('button', {
      class: classe || 'btn btn--petit', type: 'button',
      onclick: async function (ev) {
        var b = ev.currentTarget;
        b.disabled = true;
        try { await action(); } finally { if (b.isConnected) b.disabled = false; }
      }
    }, texte);
  }

  function ligneArgent(libelle, etatNoeud, action) {
    return el('div', { class: 'ligne' }, el('span', null, libelle), el('span', { class: 'ligne-d' }, etatNoeud, action));
  }

  function blocArgent(p) {
    var i = infos(p), jour = aujourdhui();

    var devis = i.signe
      ? ligneArgent('Devis de ' + euros(i.montant), pastille('ok', '✓ Signé le ' + FK.dateCourte(p.devis_signe_le)))
      : p.devis_envoye_le
        ? ligneArgent('Devis de ' + euros(i.montant), pastille('att', 'Envoyé le ' + FK.dateCourte(p.devis_envoye_le)),
            bouton('Marquer signé', function () { return majProjet(p.id, { devis_signe_le: jour }, 'Devis signé.'); }))
        : ligneArgent('Devis de ' + euros(i.montant), pastille('nv', 'Pas encore envoyé'),
            [bouton('Marquer envoyé', function () { return majProjet(p.id, { devis_envoye_le: jour }, 'Devis envoyé.'); }, 'btn btn--petit btn--clair'),
             bouton('Marquer signé', function () { return majProjet(p.id, { devis_envoye_le: jour, devis_signe_le: jour }, 'Devis signé.'); })]);

    var acompte = i.acompte === 0 ? null
      : p.acompte_verse_le ? ligneArgent('Acompte de ' + euros(i.acompte), pastille('ok', '✓ Versé le ' + FK.dateCourte(p.acompte_verse_le)))
      : i.signe ? ligneArgent('Acompte de ' + euros(i.acompte), pastille('att', 'En attente'),
          bouton('Acompte reçu', function () { return majProjet(p.id, { acompte_verse_le: jour }, 'Acompte encaissé.'); }))
      : ligneArgent('Acompte de ' + euros(i.acompte), pastille('nv', 'À la signature'));

    var solde = i.solde === 0 ? null
      : p.solde_verse_le ? ligneArgent('Solde de ' + euros(i.solde), pastille('ok', '✓ Versé le ' + FK.dateCourte(p.solde_verse_le)))
      : p.solde_facture_le ? ligneArgent('Solde de ' + euros(i.solde), pastille('att', 'Facturé le ' + FK.dateCourte(p.solde_facture_le)),
          bouton('Solde reçu', function () { return majProjet(p.id, { solde_verse_le: jour }, 'Solde encaissé.'); }))
      : i.signe ? ligneArgent('Solde de ' + euros(i.solde), pastille('nv', 'À la livraison'),
          bouton('Marquer facturé', function () { return majProjet(p.id, { solde_facture_le: jour }, 'Solde facturé.'); }, 'btn btn--petit btn--clair'))
      : ligneArgent('Solde de ' + euros(i.solde), pastille('nv', 'À la livraison'));

    return el('section', { class: 'bloc' }, el('h2', { class: 'sur' }, 'L’argent'), devis, acompte, solde);
  }

  function blocEtapeEnCours(p) {
    var c = p.client || {}, prenom = prenomDe(c);
    var titre = el('input', { type: 'text', maxlength: '160', value: p.attendu_titre || '', autocomplete: 'off' });
    var detail = el('textarea', { maxlength: '600' });
    detail.value = p.attendu_detail || '';
    var enAttente = !!(p.attendu_titre || '').trim();
    var depuis = jours(p.etape_depuis);

    function enregistrer() {
      var t = titre.value.trim(), d = detail.value.trim();
      var modif = { attendu_titre: t, attendu_detail: t ? d : '' };
      if (!t) modif.attendu_depuis = null;
      else if (t !== (p.attendu_titre || '').trim() || !p.attendu_depuis) modif.attendu_depuis = aujourdhui();
      return majProjet(p.id, modif, t ? 'Enregistré. ' + prenom + ' le voit sur sa page de suivi.' : 'Plus rien en attente.');
    }

    return el('div', { class: 'et-cours' },
      el('p', { class: 'nv' }, depuis ? 'En cours depuis ' + pluriel(depuis, 'jour', 'jours') + '.' : 'En cours depuis aujourd’hui.'),
      el('div', { class: 'form' },
        el('label', null, 'Ce que j’attends de ' + prenom + ' (affiché sur sa page de suivi)', titre),
        el('label', null, 'Précision, si besoin', detail)),
      el('div', { class: 'actions' },
        bouton('Enregistrer', enregistrer, 'btn btn--petit btn--clair'),
        enAttente ? bouton('C’est reçu', function () {
          return majProjet(p.id, { attendu_titre: '', attendu_detail: '', attendu_depuis: null }, 'Noté : plus rien en attente.');
        }, 'btn btn--petit btn--clair') : null,
        enAttente ? el('a', { class: 'btn btn--petit btn--clair', href: courrier(p, 'attendu') }, 'Relancer ' + prenom) : null),
      el('div', { class: 'actions' },
        bouton(p.etape < 9 ? 'Étape terminée' : 'Projet terminé', function () { return avancer(p); }),
        p.etape > 1 ? bouton('Revenir à l’étape précédente', function () { return reculer(p); }, 'lien lien--gris') : null)
    );
  }

  function blocChemin(p) {
    var dates = p.dates_etapes || {};
    return el('section', null,
      el('h2', { class: 'sur' }, p.termine ? 'Le chemin · terminé' : 'Le chemin · étape ' + p.etape + ' sur 9'),
      el('ol', { class: 'chemin' }, ETAPES.map(function (e) {
        var fait = p.termine || e.n < p.etape, cours = !p.termine && e.n === p.etape;
        return el('li', { class: 'et' + (fait ? '' : cours ? ' et--cours' : ' et--venir') },
          el('span', { class: 'pt ' + (fait ? 'pt--fait' : cours ? 'pt--cours' : 'pt--venir'), 'aria-hidden': 'true' }, fait ? '✓' : String(e.n)),
          el('div', null,
            el('p', { class: 'tn' }, e.nom),
            fait && dates[e.n] ? el('p', { class: 'nv' }, FK.dateCourte(dates[e.n])) : null,
            cours ? blocEtapeEnCours(p) : null));
      })),
      p.termine ? el('div', { class: 'actions' }, bouton('Rouvrir le projet', function () { return reculer(p); }, 'lien lien--gris')) : null
    );
  }

  function blocApres(p) {
    var lignes = [];
    if (p.maintenance) lignes.push(ligneArgent('Maintenance', pastille('ok', '✓ En cours')));
    if ((p.domaine || '').trim() || p.domaine_renouvellement) {
      var j = p.domaine_renouvellement ? Math.round((FK.versDate(p.domaine_renouvellement) - FK.versDate(aujourdhui())) / 864e5) : null;
      lignes.push(ligneArgent('Nom de domaine' + ((p.domaine || '').trim() ? ' : ' + p.domaine.trim() : ''),
        p.domaine_renouvellement
          ? pastille(j !== null && j <= 30 ? 'ret' : 'att', (j < 0 ? 'Échu le ' : 'Renouvellement le ') + FK.dateCourte(p.domaine_renouvellement))
          : pastille('nv', 'Date de renouvellement à renseigner')));
    }
    if (!lignes.length) return null;
    return el('section', { class: 'bloc' }, el('h2', { class: 'sur' }, 'Après la livraison'), lignes);
  }

  function blocNotes(p) {
    var zone = el('textarea', { maxlength: '5000', 'aria-label': 'Notes internes' });
    zone.value = p.notes || '';
    return el('section', { class: 'notes form' },
      el('h2', { class: 'sur' }, 'Notes internes · jamais visibles du client'),
      zone,
      el('div', { class: 'actions' }, bouton('Enregistrer la note', function () {
        return majProjet(p.id, { notes: zone.value.trim() }, 'Note enregistrée.');
      }, 'btn btn--petit btn--clair')));
  }

  function blocApercu(p) {
    var c = p.client || {}, url = lienSuivi(p);
    var champ = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Lien de suivi', onfocus: function (ev) { ev.target.select(); } });
    var coche = el('input', { type: 'checkbox', onchange: function (ev) {
      majProjet(p.id, { suivi_actif: ev.target.checked }, ev.target.checked ? 'Lien de suivi activé.' : 'Lien de suivi désactivé.');
    } });
    coche.checked = !!p.suivi_actif;

    var apercu = FK.rendreSuivi({
      prenom: c.prenom, projet: p.titre, etape: p.etape, termine: p.termine, dates_etapes: p.dates_etapes,
      attendu_titre: p.attendu_titre, attendu_detail: p.attendu_detail
    }, { apercu: true });
    if (!p.suivi_actif) apercu.classList.add('eteint');

    return el('aside', { class: 'fiche-cote' },
      el('h2', { class: 'sur' }, 'Ce que voit ' + prenomDe(c)),
      apercu,
      el('div', { class: 'lien-suivi' },
        champ,
        el('div', { class: 'actions' },
          bouton('Copier le lien', async function () {
            try { await navigator.clipboard.writeText(url); toast('Lien copié.'); }
            catch (e) { champ.focus(); champ.select(); toast('Sélectionné : faites Copier.'); }
          }),
          el('a', { class: 'btn btn--petit btn--clair', href: url, target: '_blank', rel: 'noopener' }, 'Ouvrir la page')),
        el('label', { class: 'coche-libre' }, coche, 'Lien actif'),
        el('p', { class: 'nv' }, 'Le client ne voit ni les montants, ni vos notes.'))
    );
  }

  function vueFiche(id) {
    var p = trouver(id);
    if (!p) { location.hash = '#/'; return; }
    var c = p.client || {}, prenom = prenomDe(c);

    var visibles = etat.projets.filter(function (x) { return x.id === id || !infos(x).archive; });
    var liste = el('aside', { class: 'fiche-liste', 'aria-label': 'Autres clients' },
      el('p', { class: 'sur' }, pluriel(visibles.length, 'projet', 'projets')),
      visibles.map(function (x) {
        var b = blocages(x)[0];
        return el('a', { class: 'cl' + (x.id === id ? ' actif' : ''), href: '#/client/' + x.id, 'aria-current': x.id === id ? 'page' : null },
          el('span', null, nomClient(x.client)),
          b.ton === 'ret' ? el('span', { class: 'p p--ret' }, b.jours + ' j')
            : el('span', { class: 'nv' }, x.termine ? 'Fini' : x.etape + '/9'));
      }));

    var sousTitre = [p.titre || 'Projet', (c.entreprise || '').trim()].filter(Boolean).join(' · ');
    var nomAffiche = (c.prenom || '').trim() && (c.nom || '').trim()
      ? [c.prenom.trim() + ' ', el('em', null, c.nom.trim())]
      : el('em', null, nomClient(c));

    var coord = [];
    if ((c.email || '').trim()) coord.push(el('a', { class: 'lien', href: courrier(p, '') }, 'Écrire à ' + prenom));
    if ((c.telephone || '').trim()) coord.push(el('a', { class: 'lien', href: 'tel:' + c.telephone.replace(/[^+\d]/g, '') }, c.telephone.trim()));

    var soucis = blocages(p).filter(function (b) { return b.ton !== 'nv'; });
    var autres = etat.projets.filter(function (x) { return x.client_id === p.client_id && x.id !== p.id; });

    var centre = el('section', { class: 'fiche-centre' },
      el('div', null,
        el('p', { class: 'sur' }, sousTitre + ((c.source || '').trim() ? ' · via ' + c.source.trim() : '')),
        el('h1', { class: 'titre' }, nomAffiche)),
      el('div', { class: 'actions' },
        bouton('Modifier', function () { ouvrirFormulaire('modifier', p); }, 'btn btn--petit btn--clair'),
        coord,
        p.perdu ? pastille('ret', 'Projet perdu') : null),
      soucis.length ? el('div', { class: 'actions' }, soucis.map(function (b) {
        return [pastille(b.ton, b.texte, true),
          b.relance && b.relance !== 'attendu' ? el('a', { class: 'lien', href: courrier(p, b.relance) }, 'Relancer') : null];
      })) : null,
      blocArgent(p),
      blocChemin(p),
      blocApres(p),
      blocNotes(p),
      autres.length ? el('section', null,
        el('h2', { class: 'sur' }, 'Autres projets de ' + prenom),
        autres.map(function (x) { return el('a', { class: 'cl', href: '#/client/' + x.id }, el('span', null, x.titre || 'Projet'), el('span', { class: 'nv' }, x.termine ? 'Fini' : x.etape + '/9')); })) : null,
      el('div', { class: 'danger' },
        bouton('Nouveau projet pour ' + prenom, function () { ouvrirFormulaire('ajout', p); }, 'lien'),
        bouton(p.perdu ? 'Ce projet n’est plus perdu' : 'Marquer comme perdu', function () {
          return majProjet(p.id, { perdu: !p.perdu }, p.perdu ? 'Projet rouvert.' : 'Projet marqué comme perdu.');
        }, 'lien lien--gris'),
        bouton('Supprimer', function () { return supprimer(p); }, 'lien lien--gris'))
    );

    $('nav-clients').className = '';
    document.title = nomClient(c) + ' · Clients · Fred Kopp';
    $('vue').replaceChildren(el('div', { class: 'fiche' }, liste, centre, blocApercu(p)));
  }

  function route() {
    if (!etat.pret) return;
    var m = /^#\/client\/([0-9a-f-]{36})$/.exec(location.hash);
    if (m && trouver(m[1])) vueFiche(m[1]);
    else vueTableau();
  }

  /* ------------------------------------------------------------------ */
  /* Formulaire : nouveau client, modification, nouveau projet           */
  /* ------------------------------------------------------------------ */

  var formulaire = { mode: 'nouveau', projet: null, acompteManuel: false };

  function remplirEtapes() {
    var s = $('f-etape');
    if (s.options.length) return;
    ETAPES.forEach(function (e) { s.appendChild(el('option', { value: String(e.n) }, e.n + '. ' + e.nom)); });
    s.appendChild(el('option', { value: 'fin' }, 'Projet terminé'));
  }

  function ouvrirFormulaire(mode, p) {
    remplirEtapes();
    var c = (p && p.client) || {};
    var neuf = mode !== 'modifier';
    formulaire = { mode: mode, projet: p || null, acompteManuel: !neuf };

    $('dlg-titre').textContent = mode === 'nouveau' ? 'Nouveau client' : mode === 'ajout' ? 'Nouveau projet pour ' + prenomDe(c) : 'Modifier';
    $('f-prenom').value = mode === 'nouveau' ? '' : c.prenom || '';
    $('f-nom').value = mode === 'nouveau' ? '' : c.nom || '';
    $('f-entreprise').value = mode === 'nouveau' ? '' : c.entreprise || '';
    $('f-email').value = mode === 'nouveau' ? '' : c.email || '';
    $('f-telephone').value = mode === 'nouveau' ? '' : c.telephone || '';
    $('f-source').value = mode === 'nouveau' ? '' : c.source || '';

    $('f-titre').value = neuf ? '' : p.titre || '';
    $('f-montant').value = neuf ? '' : String(Number(p.montant) || 0);
    $('f-acompte').value = neuf ? '' : String(Number(p.acompte) || 0);
    $('f-etape').value = neuf ? '1' : p.termine ? 'fin' : String(p.etape);
    $('f-envoye').value = neuf ? '' : p.devis_envoye_le || '';
    $('f-signe').value = neuf ? '' : p.devis_signe_le || '';
    $('f-acompte-verse').value = neuf ? '' : p.acompte_verse_le || '';
    $('f-solde-facture').value = neuf ? '' : p.solde_facture_le || '';
    $('f-solde-verse').value = neuf ? '' : p.solde_verse_le || '';
    $('f-maintenance').checked = neuf ? false : !!p.maintenance;
    $('f-domaine').value = neuf ? '' : p.domaine || '';
    $('f-renouvellement').value = neuf ? '' : p.domaine_renouvellement || '';

    afficher($('f-erreur'), '');
    $('dlg-valider').disabled = false;
    $('dlg-projet').showModal();
    (mode === 'ajout' ? $('f-titre') : $('f-prenom')).focus();
  }

  function fermerFormulaire() {
    if ($('dlg-projet').open) $('dlg-projet').close();
  }

  function nombre(id) {
    var v = String($(id).value || '').replace(',', '.').trim();
    if (v === '') return 0;
    var n = Number(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  async function enregistrerFormulaire(ev) {
    ev.preventDefault();
    var mode = formulaire.mode, p = formulaire.projet;
    var montant = nombre('f-montant'), acompte = nombre('f-acompte');

    var client = {
      prenom: $('f-prenom').value.trim(), nom: $('f-nom').value.trim(), entreprise: $('f-entreprise').value.trim(),
      email: $('f-email').value.trim(), telephone: $('f-telephone').value.trim(), source: $('f-source').value.trim()
    };
    var etapeChoisie = $('f-etape').value;
    var projet = {
      titre: $('f-titre').value.trim(), montant: montant, acompte: acompte,
      devis_envoye_le: $('f-envoye').value || null, devis_signe_le: $('f-signe').value || null,
      acompte_verse_le: $('f-acompte-verse').value || null, solde_facture_le: $('f-solde-facture').value || null,
      solde_verse_le: $('f-solde-verse').value || null,
      maintenance: $('f-maintenance').checked, domaine: $('f-domaine').value.trim(),
      domaine_renouvellement: $('f-renouvellement').value || null,
      termine: etapeChoisie === 'fin', etape: etapeChoisie === 'fin' ? 9 : Number(etapeChoisie)
    };

    var souci = '';
    if (!client.prenom) souci = 'Indiquez au moins le prénom du client.';
    else if (!projet.titre) souci = 'Donnez un intitulé au projet, par exemple « Site vitrine ».';
    else if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) souci = 'L’adresse e-mail semble incomplète.';
    else if (isNaN(montant) || montant < 0 || montant > 99999999) souci = 'Le montant du devis n’est pas un nombre valide.';
    else if (isNaN(acompte) || acompte < 0) souci = 'L’acompte n’est pas un nombre valide.';
    else if (acompte > montant) souci = 'L’acompte ne peut pas dépasser le montant du devis.';
    else if (projet.devis_signe_le && !projet.devis_envoye_le) projet.devis_envoye_le = projet.devis_signe_le;
    if (souci) { afficher($('f-erreur'), souci); return; }

    afficher($('f-erreur'), '');
    $('dlg-valider').disabled = true;
    var id = null, r;

    try {
      if (mode === 'modifier') {
        if (projet.etape !== p.etape || projet.termine !== !!p.termine) projet.etape_depuis = aujourdhui();
        r = await sb.from('clients').update(client).eq('id', p.client_id);
        if (r.error) throw r.error;
        r = await sb.from('projets').update(projet).eq('id', p.id);
        if (r.error) throw r.error;
        id = p.id;
      } else {
        var clientId = mode === 'ajout' ? p.client_id : null;
        if (mode === 'ajout') {
          r = await sb.from('clients').update(client).eq('id', clientId);
          if (r.error) throw r.error;
        } else {
          r = await sb.from('clients').insert(client).select('id').single();
          if (r.error) throw r.error;
          clientId = r.data.id;
        }
        projet.client_id = clientId;
        projet.jeton = nouveauJeton(client.prenom);
        r = await sb.from('projets').insert(projet).select('id').single();
        if (r.error) {
          if (mode === 'nouveau') await sb.from('clients').delete().eq('id', clientId);
          throw r.error;
        }
        id = r.data.id;
      }
      await charger();
    } catch (e) {
      afficher($('f-erreur'), 'Enregistrement impossible. ' + lisible(e));
      $('dlg-valider').disabled = false;
      return;
    }

    fermerFormulaire();
    if (location.hash === '#/client/' + id) route(); else location.hash = '#/client/' + id;
    toast(mode === 'modifier' ? 'Modifications enregistrées.' : 'Projet créé.');
  }

  /* ------------------------------------------------------------------ */
  /* Connexion                                                           */
  /* ------------------------------------------------------------------ */

  async function entrer() {
    if (etat.entree) return;
    etat.entree = true;
    montrer('chargement');
    try {
      var r = await sb.from('admins').select('user_id').eq('user_id', etat.uid).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) {
        $('refus-texte').textContent = 'Le compte ' + etat.email + ' n’a pas accès à cet espace.';
        montrer('ecran-refus');
        return;
      }
      await charger();
      etat.pret = true;
      montrer('app');
      route();
    } catch (e) {
      $('refus-texte').textContent = 'Impossible de charger vos clients. ' + lisible(e);
      montrer('ecran-refus');
    } finally {
      etat.entree = false;
    }
  }

  function surSession(evenement, session) {
    if (!session) {
      etat.uid = null; etat.email = ''; etat.projets = []; etat.pret = false;
      fermerFormulaire();
      $('vue').replaceChildren();
      montrer('ecran-connexion');
      if (lienErreur) {
        lienErreur = false;
        afficher($('connexion-info'), 'Ce lien n’est plus valable : il a expiré ou a déjà servi. Demandez-en un nouveau ci-dessous.');
        history.replaceState(null, '', location.pathname);
      }
      return;
    }
    if (evenement === 'PASSWORD_RECOVERY') lienMdp = true;
    var change = etat.uid !== session.user.id;
    etat.uid = session.user.id;
    etat.email = session.user.email || '';
    if (lienMdp) {
      $('m-email').value = etat.email;
      montrer('ecran-mdp');
      return;
    }
    if (change || !etat.pret) entrer();
  }

  // La bibliothèque demande de ne pas rappeler la base depuis ce signal : on diffère d'un cran.
  sb.auth.onAuthStateChange(function (evenement, session) {
    setTimeout(function () { surSession(evenement, session); }, 0);
  });

  $('form-connexion').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var b = ev.target.querySelector('button[type="submit"]');
    afficher($('c-erreur'), '');
    b.disabled = true;
    var r = await sb.auth.signInWithPassword({ email: $('c-email').value.trim(), password: $('c-mdp').value });
    b.disabled = false;
    if (r.error) {
      afficher($('c-erreur'), /Invalid login|credentials/i.test(r.error.message)
        ? 'E-mail ou mot de passe incorrect.'
        : 'Connexion impossible. ' + lisible(r.error));
      return;
    }
    $('c-mdp').value = '';
  });

  $('lien-oubli').addEventListener('click', function () {
    var f = $('form-oubli');
    f.hidden = !f.hidden;
    $('lien-oubli').setAttribute('aria-expanded', String(!f.hidden));
    if (!f.hidden) { $('o-email').value = $('c-email').value; $('o-email').focus(); }
  });

  $('form-oubli').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var adresse = $('o-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse)) { afficher($('o-msg'), 'Indiquez votre adresse e-mail.'); return; }
    var b = ev.target.querySelector('button[type="submit"]');
    b.disabled = true;
    var r = await sb.auth.resetPasswordForEmail(adresse, { redirectTo: FK.CONFIG.site + '/crm/' });
    b.disabled = false;
    afficher($('o-msg'), r.error
      ? 'Envoi impossible pour le moment. Réessayez dans une heure.'
      : 'Si cette adresse est la bonne, un e-mail vient de partir. Ouvrez-le et cliquez sur le lien : vous choisirez votre mot de passe.');
  });

  $('form-mdp').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var a = $('m-mdp').value, b2 = $('m-mdp2').value;
    if (a.length < 10) { afficher($('m-erreur'), 'Le mot de passe doit faire au moins 10 caractères.'); return; }
    if (a !== b2) { afficher($('m-erreur'), 'Les deux mots de passe ne sont pas identiques.'); return; }
    var b = ev.target.querySelector('button[type="submit"]');
    afficher($('m-erreur'), '');
    b.disabled = true;
    var r = await sb.auth.updateUser({ password: a });
    b.disabled = false;
    if (r.error) {
      afficher($('m-erreur'), /different from the old/i.test(r.error.message)
        ? 'Choisissez un mot de passe différent de l’ancien.'
        : /weak|pwned|leaked|should contain|at least/i.test(r.error.message)
          ? 'Ce mot de passe est trop simple ou trop connu. Choisissez-en un autre.'
          : 'Mot de passe refusé. ' + lisible(r.error));
      return;
    }
    lienMdp = false;
    $('m-mdp').value = $('m-mdp2').value = '';
    await entrer();
    if (etat.pret) toast('Mot de passe enregistré.');
  });

  function deconnecter() { sb.auth.signOut(); }
  $('btn-deconnexion').addEventListener('click', deconnecter);
  $('refus-sortir').addEventListener('click', deconnecter);

  /* ------------------------------------------------------------------ */
  /* Branchements                                                        */
  /* ------------------------------------------------------------------ */

  $('btn-nouveau').addEventListener('click', function () { ouvrirFormulaire('nouveau'); });
  $('dlg-fermer').addEventListener('click', fermerFormulaire);
  $('dlg-annuler').addEventListener('click', fermerFormulaire);
  $('form-projet').addEventListener('submit', enregistrerFormulaire);
  $('form-projet').addEventListener('input', function () { afficher($('f-erreur'), ''); });

  // L'acompte suit 30 % du devis tant qu'il n'a pas été saisi à la main.
  $('f-acompte').addEventListener('input', function () { formulaire.acompteManuel = true; });
  $('f-montant').addEventListener('input', function () {
    if (formulaire.acompteManuel) return;
    var m = nombre('f-montant');
    $('f-acompte').value = isNaN(m) || !m ? '' : String(Math.round(m * 0.3));
  });

  window.addEventListener('hashchange', route);
})();
