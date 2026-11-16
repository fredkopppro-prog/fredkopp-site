/* Page de suivi : le client ouvre son lien secret et voit où en est son projet. */
(function () {
  'use strict';

  var FK = window.FK, el = FK.el;
  var zone = document.getElementById('suivi');

  function message(titre, texte) {
    zone.replaceChildren(el('section', { class: 'sv-message' },
      el('h1', null, titre),
      el('p', null, texte, ' ', el('a', { href: 'mailto:' + FK.CONFIG.contact }, FK.CONFIG.contact))
    ));
  }

  // Le jeton est dans la partie après « # » : elle n'est jamais envoyée au serveur du site.
  var jeton = (location.hash || '').replace(/^#/, '') || new URLSearchParams(location.search).get('c') || '';

  if (!/^[a-z0-9-]{20,64}$/.test(jeton)) {
    message('Ce lien de suivi n’est pas complet.', 'Reprenez le lien reçu par e-mail, ou écrivez-moi :');
    return;
  }

  fetch(FK.CONFIG.url + '/rest/v1/rpc/suivi', {
    method: 'POST',
    headers: { apikey: FK.CONFIG.cle, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_jeton: jeton })
  })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      if (!d) {
        message('Ce lien de suivi n’est plus actif.', 'Pour savoir où en est votre projet, écrivez-moi :');
        return;
      }
      zone.replaceChildren(FK.rendreSuivi(d));
    })
    .catch(function () {
      message('Le suivi est momentanément indisponible.', 'Réessayez dans quelques minutes, ou écrivez-moi :');
    });
})();
