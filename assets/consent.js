/* Beemo Air · consentimiento: aviso de cookies, medición de visitas solo con permiso
   y casillas separadas de Términos y Privacidad en cada formulario (con registro en el servidor). */
(function () {
  'use strict';
  var V = '2026-11-27', KEY = 'beemo-consent';
  var en = function () { return (document.documentElement.lang || '').indexOf('en') === 0 };
  var T = function (es, eng) { return en() ? eng : es };

  /* estilos: idioma de los textos dobles, casillas legales y aviso */
  var css = 'html[lang^="en"] [data-l="es"],html:not([lang^="en"]) [data-l="en"]{display:none!important}'
    + '.lchk{display:flex;flex-direction:column;gap:10px;margin:14px 0 4px}'
    + '.lchk label{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.45;font-weight:400;cursor:pointer;text-align:left}'
    + '.lchk input{width:20px;height:20px;margin:1px 0 0;flex:none;accent-color:#101B36;cursor:pointer}'
    + '.lchk a{font-weight:600;text-decoration:underline;text-underline-offset:2px}'
    + '.lchk .opt{opacity:.85}'
    + '.ckb{position:fixed;left:16px;bottom:16px;z-index:2147483000;max-width:440px;background:#101B36;color:#F4F7FB;border-radius:18px;padding:18px 18px 16px;box-shadow:0 18px 50px rgba(5,10,23,.35);font:14px/1.5 "Instrument Sans",system-ui,-apple-system,Arial,sans-serif}'
    + '.ckb h2{font:800 16px/1.2 Urbanist,system-ui,sans-serif;margin:0 0 6px;color:#fff;letter-spacing:-.01em}'
    + '.ckb p{margin:0 0 12px;color:rgba(244,247,251,.86)}.ckb a{color:#B9F44D;font-weight:600}'
    + '.ckb .ckb-a{display:flex;gap:8px;flex-wrap:wrap}'
    + '.ckb button{flex:1 1 150px;border-radius:999px;padding:10px 16px;font-weight:600;font-size:14px;line-height:1.2;font-family:inherit;cursor:pointer;border:1px solid #B9F44D}'
    + '.ckb .ckb-y{background:#B9F44D;color:#101B36}.ckb .ckb-n{background:transparent;color:#fff;border-color:rgba(255,255,255,.55)}'
    + '.ckb button:focus-visible{outline:2px solid #fff;outline-offset:2px}'
    + '@media (max-width:560px){.ckb{left:8px;right:8px;bottom:8px;max-width:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* preferencia guardada en este navegador */
  function read() { try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.v === V ? c : null } catch (e) { return null } }
  function rid() { var a = 'abcdefghijklmnopqrstuvwxyz0123456789', s = ''; for (var i = 0; i < 20; i++) s += a[Math.floor(Math.random() * a.length)]; return s }
  function post(path, body) { try { return fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }) } catch (e) { return Promise.resolve() } }

  /* visitas: solo se avisan si la persona aceptó la medición */
  var sent = false;
  function visit() {
    if (sent || navigator.webdriver) return; var c = read(); if (!c || !c.analytics) return; sent = true;
    var r = ''; try { r = document.referrer ? new URL(document.referrer).hostname : '' } catch (e) {}
    post('/visit', { p: location.pathname, r: r, l: (navigator.language || '').slice(0, 5) }).catch(function () {});
  }

  function save(analytics, how) {
    var prev = read(), c = { v: V, analytics: !!analytics, at: new Date().toISOString(), cid: (prev && prev.cid) || rid() };
    try { localStorage.setItem(KEY, JSON.stringify(c)) } catch (e) {}
    post('/consent', { form: 'cookies', cid: c.cid, analytics: c.analytics, label: how, page: location.pathname, lang: en() ? 'en' : 'es' }).catch(function () {});
    hide(); if (c.analytics) visit();
    document.dispatchEvent(new CustomEvent('beemo-consent', { detail: c }));
    return c;
  }

  var box = null;
  function hide() { if (box) { box.remove(); box = null } }
  function show() {
    if (box) return;
    box = document.createElement('section'); box.className = 'ckb'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', T('Aviso de cookies', 'Cookie notice')); box.setAttribute('data-noi18n', '');
    box.innerHTML = '<h2><span data-l="es">Tu privacidad</span><span data-l="en">Your privacy</span></h2>'
      + '<p><span data-l="es">Usamos almacenamiento necesario para que el sitio funcione. Si aceptas, también medimos las visitas (página vista, dirección IP y ciudad aproximada) para mejorar el servicio. Puedes cambiarlo cuando quieras en la <a href="/cookies/">Política de cookies</a>.</span>'
      + '<span data-l="en">We use necessary storage so the site works. If you accept, we also measure visits (page viewed, IP address and approximate city) to improve the service. You can change this at any time in the <a href="/cookies/?lang=en">Cookie Policy</a>.</span></p>'
      + '<div class="ckb-a"><button type="button" class="ckb-y"><span data-l="es">Aceptar medición</span><span data-l="en">Accept measurement</span></button>'
      + '<button type="button" class="ckb-n"><span data-l="es">Solo necesarias</span><span data-l="en">Necessary only</span></button></div>';
    document.body.appendChild(box);
    box.querySelector('.ckb-y').addEventListener('click', function () { save(true, T('Botón «Aceptar medición» del aviso de cookies', 'Cookie notice button "Accept measurement"')) });
    box.querySelector('.ckb-n').addEventListener('click', function () { save(false, T('Botón «Solo necesarias» del aviso de cookies', 'Cookie notice button "Necessary only"')) });
  }

  /* casillas legales: lee las de un formulario y arma lo que se envía al servidor */
  function labelText(input) {
    var l = input && input.closest('label'); if (!l) return '';
    var span = l.querySelector('[data-l="' + (en() ? 'en' : 'es') + '"]') || l; return span.textContent.replace(/\s+/g, ' ').trim();
  }
  function collect(root) {
    var q = function (n) { return root.querySelector('[name="' + n + '"]') }, t = q('acepto_terminos'), p = q('acepto_privacidad'), m = q('acepto_comunicaciones');
    var c = { terms: !!(t && t.checked), privacy: !!(p && p.checked), labels: { terms: labelText(t), privacy: labelText(p) }, page: location.pathname, lang: en() ? 'en' : 'es', v: V };
    if (m) { c.marketing = !!m.checked; c.labels.marketing = labelText(m) }
    return c;
  }
  // el primer requisito que falta, para mostrarlo junto al formulario
  function missing(c) { return !c.terms ? T('Para continuar, acepta los Términos y condiciones.', 'To continue, accept the Terms and Conditions.') : !c.privacy ? T('Para continuar, acepta la Política de privacidad.', 'To continue, accept the Privacy Policy.') : '' }
  // casillas para formularios que se arman con JavaScript
  function boxes(opts) {
    opts = opts || {};
    var h = '<div class="lchk" data-noi18n>'
      + '<label><input type="checkbox" name="acepto_terminos"> <span data-l="es">Acepto los <a href="/terminos/" target="_blank" rel="noopener">Términos y condiciones</a>' + (opts.refunds ? ' y la <a href="/reembolsos/" target="_blank" rel="noopener">Política de reembolsos</a>' : '') + '.</span>'
      + '<span data-l="en">I accept the <a href="/terminos/?lang=en" target="_blank" rel="noopener">Terms and Conditions</a>' + (opts.refunds ? ' and the <a href="/reembolsos/?lang=en" target="_blank" rel="noopener">Refund Policy</a>' : '') + '.</span></label>'
      + '<label><input type="checkbox" name="acepto_privacidad"> <span data-l="es">Autorizo el tratamiento de mis datos personales según la <a href="/privacidad/" target="_blank" rel="noopener">Política de privacidad</a>.</span>'
      + '<span data-l="en">I authorize the processing of my personal data under the <a href="/privacidad/?lang=en" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>';
    if (opts.marketing) h += '<label class="opt"><input type="checkbox" name="acepto_comunicaciones"> <span data-l="es">Opcional: quiero recibir ofertas y novedades de Beemo Air por correo o WhatsApp.</span><span data-l="en">Optional: I want to receive offers and news from Beemo Air by email or WhatsApp.</span></label>';
    return h + '</div>';
  }
  // registro de aceptación para formularios que no pasan por una reserva (cotización, PQRS)
  function log(form, data, c) { return post('/consent', { form: form, email: data.email, name: data.name, ref: data.ref, consents: c }) }

  window.BeemoConsent = { version: V, get: read, set: function (a) { return save(a, T('Preferencias de la Política de cookies', 'Cookie Policy preferences')) }, open: show };
  window.BeemoLegal = { version: V, collect: collect, missing: missing, boxes: boxes, log: log };

  function start() {
    var c = read();
    if (!c && navigator.globalPrivacyControl === true) c = save(false, T('Señal Global Privacy Control del navegador', 'Browser Global Privacy Control signal'));
    if (!c) show(); else visit();
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-cookie-prefs]'); if (b) { e.preventDefault(); show(); var y = box && box.querySelector('button'); if (y) y.focus() } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
