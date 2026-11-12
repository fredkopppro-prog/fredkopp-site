/* Les messages du formulaire arrivent sur cette adresse (service gratuit FormSubmit). */
var FORM_ENDPOINT = 'https://formsubmit.co/ajax/fred.kopp.pro@gmail.com';

(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };

  /* Compteurs : la valeur finale est déjà dans la page, l'animation ne fait que la rejouer. */
  var counters = document.querySelectorAll('[data-count]');
  if (!reduce && 'IntersectionObserver' in window && counters.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        var el = en.target;
        io.unobserve(el);
        var target = parseInt(el.getAttribute('data-count'), 10);
        var suffix = el.getAttribute('data-suffix') || '';
        var t0 = performance.now(), d = 1900;
        var step = function (t) {
          var p = Math.min(1, (t - t0) / d);
          var e = 1 - Math.pow(1 - p, 3);
          el.textContent = fmt(Math.round(target * e)) + suffix;
          if (p < 1) { requestAnimationFrame(step); }
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { io.observe(el); });
  }

  /* Formulaire : envoyé par Netlify Forms une fois en ligne ; en aperçu, simple message. */
  var form = document.getElementById('contact-form');
  if (form) {
    var live = /fredkopp\.(com|fr)$|github\.io$/.test(location.hostname);
    var msg = document.getElementById('form-msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!live) {
        msg.textContent = 'Aperçu : le formulaire sera actif une fois le site en ligne.';
        return;
      }
      fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) })
        .then(function (r) {
          if (!r.ok) { throw new Error(); }
          form.reset();
          msg.textContent = 'Merci, votre message est bien parti. Réponse sous 24 heures.';
        })
        .catch(function () {
          msg.textContent = "L'envoi n'a pas abouti. Écrivez directement à contact@fredkopp.com.";
        });
    });
  }

  var y = document.getElementById('year');
  if (y) { y.textContent = new Date().getFullYear(); }
})();

/* Pop-up « Démarrer un projet » : la page recule en 3D, la fenêtre arrive en pivotant. */
(function () {
  var EMAIL = 'contact@fredkopp.com';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, reduce ? 0 : ms); }); };
  var live = /fredkopp\.(com|fr)$|github\.io$/.test(location.hostname);

  /* La page entière dans un conteneur qui pourra reculer */
  var world = document.createElement('div');
  world.className = 'world';
  [].slice.call(document.body.children).forEach(function (el) {
    if (el.tagName !== 'SCRIPT') { world.appendChild(el); }
  });
  document.body.insertBefore(world, document.body.firstChild);

  var scrim = document.createElement('div'); scrim.className = 'p-scrim'; scrim.hidden = true;
  var pop = document.createElement('div');
  pop.className = 'pop'; pop.hidden = true; pop.tabIndex = -1;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-labelledby', 'pop-t');
  pop.innerHTML =
    '<span class="glare" aria-hidden="true"></span>' +
    '<button class="pop-close" type="button" aria-label="Fermer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
    '<form class="in form" id="pop-form" name="contact" novalidate>' +
      '<input type="hidden" name="_subject" value="Nouveau projet depuis fredkopp.com"><input type="hidden" name="_template" value="table"><input type="hidden" name="besoin" value="Créer ou refaire mon site">' +
      '<h2 class="pop-title" id="pop-t">Parlons de votre <em>projet.</em></h2>' +
      '<p class="pop-sub">Réponse sous 24 heures. Deux projets à la fois, pas plus.</p>' +
      '<div class="pop-chips" role="group" aria-label="Votre besoin">' +
        '<button type="button" class="pop-chip" aria-pressed="false" data-v="Un audit de mon site">Un audit</button>' +
        '<button type="button" class="pop-chip" aria-pressed="true" data-v="Créer ou refaire mon site">Un site</button>' +
        '<button type="button" class="pop-chip" aria-pressed="false" data-v="Une application">Une application</button>' +
      '</div>' +
      '<label for="pop-nom">Nom<input id="pop-nom" name="nom" autocomplete="name"></label>' +
      '<label for="pop-mail">E-mail<input id="pop-mail" name="email" type="email" autocomplete="email"></label>' +
      '<label for="pop-projet">Votre projet en quelques lignes<textarea id="pop-projet" name="projet"></textarea></label>' +
      '<div class="pop-actions"><button class="btn" type="submit">Envoyer</button><button class="btn btn--ghost" type="button" id="pop-mailbtn">Ouvrir ma messagerie</button></div>' +
      '<p class="pop-hint">Ou écrivez à <b>' + EMAIL + '</b> · <a href="https://calendar.app.google/M1YHv9GtAptPy2y47" target="_blank" rel="noopener">réservez un appel de 20 min</a></p>' +
      '<p class="form-msg" id="pop-msg" role="status" aria-live="polite"></p>' +
    '</form>';
  document.body.appendChild(scrim);
  document.body.appendChild(pop);

  var form = pop.querySelector('form'), msg = pop.querySelector('#pop-msg');
  var besoin = form.querySelector('input[name="besoin"]');
  var isOpen = false, busy = false, opener = null;

  form.querySelector('.pop-chips').addEventListener('click', function (e) {
    var b = e.target.closest('.pop-chip'); if (!b) { return; }
    form.querySelectorAll('.pop-chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', 'true'); besoin.value = b.getAttribute('data-v');
  });
  function data() { return { besoin: besoin.value, nom: form.nom.value.trim(), email: form.email.value.trim(), projet: form.projet.value.trim() }; }
  function say(t, bad) { msg.style.color = bad ? '#A3261B' : ''; msg.textContent = t; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = data();
    if (!d.nom || !/^\S+@\S+\.\S+$/.test(d.email)) { say('Indiquez votre nom et un e-mail valide.', true); return; }
    if (!live) { say('Aperçu : le formulaire sera actif une fois le site en ligne.'); return; }
    fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) })
      .then(function (r) { if (!r.ok) { throw new Error(); } form.reset(); say('Merci, votre message est bien parti. Réponse sous 24 heures.'); })
      .catch(function () { say("L'envoi n'a pas abouti. Écrivez directement à " + EMAIL + '.', true); });
  });
  pop.querySelector('#pop-mailbtn').addEventListener('click', function () {
    var d = data();
    var subject = 'Nouveau projet · ' + d.besoin;
    var body = 'Bonjour Fred,\n\n' + (d.projet || '[Décrivez votre projet en quelques lignes]') + '\n\nBesoin : ' + d.besoin + '\n' + d.nom + '\n' + d.email;
    location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    say('Votre messagerie devrait s’ouvrir. Sinon, écrivez à ' + EMAIL + '.');
  });

  function open(btn) {
    if (isOpen || busy) { return; }
    busy = true; opener = btn; say('');
    var want = btn.getAttribute('data-besoin');
    if (want) { form.querySelectorAll('.pop-chip').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-v') === want ? 'true' : 'false'); }); besoin.value = want; }
    var pre = btn.getAttribute('data-projet');
    if (pre && !form.projet.value) { form.projet.value = pre; }
    world.style.transformOrigin = '50% ' + (window.scrollY + window.innerHeight * 0.35) + 'px';
    document.documentElement.classList.add('portal-open');
    world.classList.add('away'); world.setAttribute('aria-hidden', 'true');
    scrim.hidden = false; requestAnimationFrame(function () { scrim.classList.add('on'); });
    wait(380).then(function () {
      pop.hidden = false; pop.classList.remove('show', 'sweep');
      pop.querySelectorAll('.in > *').forEach(function (c, i) { c.style.transitionDelay = (0.06 + i * 0.05) + 's'; });
      requestAnimationFrame(function () { requestAnimationFrame(function () { pop.classList.add('show', 'sweep'); }); });
      if (!reduce && pop.animate) {
        pop.animate([
          { transform: 'translate(-50%,-50%) perspective(1200px) translateZ(-1400px) rotateY(-75deg) rotateX(20deg)', opacity: 0, filter: 'blur(10px)' },
          { opacity: 1, filter: 'blur(0)', offset: 0.5 },
          { transform: 'translate(-50%,-50%) perspective(1200px) translateZ(60px) rotateY(6deg) rotateX(-2deg)', offset: 0.78 },
          { transform: 'translate(-50%,-50%) perspective(1200px) translateZ(0) rotateY(0) rotateX(0)', opacity: 1 }
        ], { duration: 1200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      return wait(450);
    }).then(function () { if (window.matchMedia('(pointer: fine)').matches) { pop.querySelector('#pop-nom').focus({ preventScroll: true }); } else { pop.focus({ preventScroll: true }); } busy = false; isOpen = true; });
  }
  function close() {
    if (!isOpen) { return; }
    isOpen = false; busy = true;
    var a = (!reduce && pop.animate) ? pop.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: 'translate(-50%,-50%) scale(.85)', opacity: 0, filter: 'blur(8px)' }
    ], { duration: 380, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }) : null;
    world.classList.remove('away'); world.removeAttribute('aria-hidden'); scrim.classList.remove('on');
    wait(900).then(function () {
      pop.hidden = true; pop.classList.remove('show', 'sweep'); if (a) { a.cancel(); }
      scrim.hidden = true; document.documentElement.classList.remove('portal-open'); world.style.transformOrigin = '';
      if (opener) { opener.focus({ preventScroll: true }); }
      busy = false;
    });
  }
  pop.querySelector('.pop-close').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (!isOpen) { return; }
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') { return; }
    var f = [].filter.call(pop.querySelectorAll('button, input, textarea'), function (x) { return x.offsetParent !== null; });
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  document.querySelectorAll('a.btn[href$="#contact"]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); open(a); });
  });
})();

/* Test de site instantané (Google PageSpeed Insights) */
(function () {
  var PSI_KEY = ''; /* clé API Google gratuite, à ajouter pour lever la limite d'usage */
  var f = document.getElementById('psi-form'); if (!f) { return; }
  var input = document.getElementById('psi-url'), scan = document.getElementById('psi-scan'), err = document.getElementById('psi-err');
  var out = document.getElementById('psi-out'), rings = document.getElementById('psi-rings'), go = document.getElementById('psi-go');
  var cats = [['performance', 'Vitesse'], ['seo', 'Référencement'], ['accessibility', 'Accessibilité'], ['best-practices', 'Bonnes pratiques']];
  var color = function (v) { return v >= 90 ? '#4CC38A' : (v >= 50 ? '#F5A524' : '#FF7A6B'); };

  function normalize(u) {
    u = u.trim(); if (!u) { return ''; }
    if (!/^https?:\/\//i.test(u)) { u = 'https://' + u; }
    try { var x = new URL(u); return /\./.test(x.hostname) ? x.href : ''; } catch (e) { return ''; }
  }
  function verdict(s) {
    var t = [];
    if (s.performance < 50) { t.push('Votre site met trop de temps à s’afficher sur téléphone : une partie de vos visiteurs part avant de le voir.'); }
    else if (s.performance < 90) { t.push('La vitesse sur téléphone est correcte, mais perfectible.'); }
    if (s.seo < 90) { t.push('Google comprend mal certaines pages : vous êtes moins bien placé que vous pourriez l’être.'); }
    if (s.accessibility < 80) { t.push('Une partie du site est difficile à lire ou à utiliser, surtout sur mobile.'); }
    if (!t.length) { t.push('Belle base technique. Reste à vérifier ce que Google ne mesure pas : votre message, votre parcours et la prise de contact.'); }
    return t.join(' ');
  }
  function draw(scores) {
    rings.innerHTML = '';
    var C = 2 * Math.PI * 48;
    cats.forEach(function (c) {
      var v = scores[c[0]];
      var d = document.createElement('div'); d.className = 'ring';
      d.innerHTML = '<svg viewBox="0 0 112 112" aria-hidden="true"><circle class="track" cx="56" cy="56" r="48"></circle><circle class="val" cx="56" cy="56" r="48" stroke="' + color(v) + '" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"></circle></svg>' +
        '<div class="ring-num" style="color:' + color(v) + '">' + v + '</div><span>' + c[1] + '</span>';
      d.setAttribute('role', 'img'); d.setAttribute('aria-label', c[1] + ' : ' + v + ' sur 100');
      rings.appendChild(d);
      requestAnimationFrame(function () { requestAnimationFrame(function () { d.querySelector('.val').style.strokeDashoffset = C * (1 - v / 100); }); });
    });
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = normalize(input.value);
    err.hidden = true;
    if (!url) { err.textContent = 'Entrez une adresse valide, par exemple www.votresite.fr.'; err.hidden = false; input.focus(); return; }
    out.hidden = true; scan.hidden = false; go.disabled = true;
    var api = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&url=' + encodeURIComponent(url) +
      cats.map(function (c) { return '&category=' + c[0]; }).join('') + (PSI_KEY ? '&key=' + PSI_KEY : '');
    fetch(api).then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.json(); }).then(function (j) {
      var lr = j.lighthouseResult, scores = {};
      cats.forEach(function (c) { scores[c[0]] = Math.round((lr.categories[c[0]].score || 0) * 100); });
      var lcp = lr.audits['largest-contentful-paint'];
      document.getElementById('psi-lcp').textContent = lcp ? 'Affichage du contenu principal sur téléphone : ' + lcp.displayValue.replace(/ /g, ' ') : '';
      document.getElementById('psi-verdict').textContent = verdict(scores);
      document.getElementById('psi-cta').setAttribute('data-projet', 'Audit de ' + url + ' (scores Google : vitesse ' + scores.performance + ', référencement ' + scores.seo + ').');
      scan.hidden = true; out.hidden = false; draw(scores);
    }).catch(function () {
      scan.hidden = true;
      err.textContent = 'Le test n’a pas pu aboutir (site injoignable ou service saturé). Réessayez dans un instant, ou demandez directement l’audit complet.';
      err.hidden = false;
    }).then(function () { go.disabled = false; });
  });
})();

/* Showcase hero */
(function () {
  var slides = [].slice.call(document.querySelectorAll('.sc-slide')); if (slides.length < 2) { return; }
  var dots = document.querySelector('.sc-dots'), url = document.getElementById('sc-url'), nm = document.getElementById('sc-name'), wh = document.getElementById('sc-what');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var i = 0, timer = null;
  slides.forEach(function (s, k) {
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', s.getAttribute('data-name')); b.setAttribute('aria-selected', k === 0 ? 'true' : 'false');
    b.addEventListener('click', function () { go(k); restart(); }); dots.appendChild(b);
  });
  function go(k) {
    slides[i].classList.remove('on'); dots.children[i].setAttribute('aria-selected', 'false');
    i = k; var s = slides[i];
    s.classList.add('on'); dots.children[i].setAttribute('aria-selected', 'true');
    url.textContent = s.getAttribute('data-url'); nm.textContent = s.getAttribute('data-name'); wh.textContent = s.getAttribute('data-what');
  }
  function restart() { clearInterval(timer); if (!reduce) { timer = setInterval(function () { go((i + 1) % slides.length); }, 4500); } }
  restart();
  document.addEventListener('visibilitychange', function () { if (document.hidden) { clearInterval(timer); } else { restart(); } });
})();
