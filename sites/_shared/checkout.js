// Checkout for every course site, served to each one at /_shared/checkout.js and
// loaded by its checkout.html after /_shared/config.js. The page's form names
// the site's one course (written by scripts/build-checkout.py):
//
//   <form id="checkoutForm" data-site="back-safety" data-lms-id="296"
//         data-price="29.99" data-name="Back Safety and Injury Prevention Training">
//
// Payment works like datacentertraining.us (js/checkout.js), so orders land in
// the hazwoper-osha.com LMS the same way:
//   1. Stripe.js turns the card into a PaymentMethod. The card number stays in
//      Stripe's iframe; this page never sees it.
//   2. POST {API}/add_new_user -> customer id
//   3. POST {API}/add_order    -> order for course_id = lmsId, quantity = seats,
//      order_from = "<site>.hazwoperosha.com". If the LMS answers with a
//      clientSecret, Stripe confirms the payment (3-D Secure if the bank asks);
//      a failed confirmation is reported with POST {API}/failed_status, as
//      hazwoper-osha.com's own checkout does.
// The LMS prices the order from course_id and quantity: no amount is sent, so
// editing the page can't change what is charged. The seat price shown comes from
// {API}/roi_tier_price, the price the LMS itself quotes for that many seats.
//
// Security: no third-party script but Stripe.js (the CSP in _headers allows
// nothing else), every value reaches the page through textContent (never
// innerHTML), inputs are length-capped and checked, and a honeypot field, a
// minimum fill time and a per-tab attempt limit slow down card-testing bots.
(function () {
  'use strict';

  var CFG = window.HZ_CHECKOUT;
  var form = document.getElementById('checkoutForm');
  if (!CFG || !form) return;

  var LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  var $ = function (id) { return document.getElementById(id); };

  // ---- the course this site sells ------------------------------------------
  var course = {
    site: form.getAttribute('data-site') || '',
    lmsId: parseInt(form.getAttribute('data-lms-id'), 10),
    price: Number(form.getAttribute('data-price')),
    name: form.getAttribute('data-name') || ''
  };
  var courseOk = LABEL.test(course.site) && course.lmsId > 0 && course.price > 0 && course.name !== '';
  var ORDER_FROM = course.site + '.' + CFG.ROOT_DOMAIN;
  // Without a valid course, or while card checkout is switched off, the page
  // composes an enrollment-request email instead (as datacentertraining.us does).
  var requestMode = CFG.CHECKOUT_DISABLED || !courseOk;

  // ---- helpers --------------------------------------------------------------
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var money = function (n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var setText = function (id, text) { var el = $(id); if (el) el.textContent = text; };
  var show = function (el, on) { if (el) el.hidden = !on; };
  var clean = function (s, max) {
    // Trim, drop control characters, collapse whitespace, cap the length.
    return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 100);
  };
  var value = function (id, max) { var el = $(id); return el ? clean(el.value, max) : ''; };
  var positiveId = function (x) { var n = parseInt(x, 10); return n > 0 && n < 1e12 ? n : 0; };
  var messageOf = function (err, fallback) {
    var m = '';
    if (typeof err === 'string') m = err;
    else if (err && typeof err.message === 'string') m = err.message;
    else if (err && typeof err.error === 'string') m = err.error;
    else if (err && err.error && typeof err.error.message === 'string') m = err.error.message;
    m = clean(m.replace(/[<>]/g, ' '), 240);
    return m || fallback;
  };

  var GENERIC = 'Payment failed. Please check your card details and try again.';
  var CONTACT = ' You can also enroll by phone at ' + CFG.PHONE + ' or by email at ' + CFG.ENROLL_EMAIL + '.';

  // POST JSON to the LMS API. Never sends cookies; gives up after REQUEST_TIMEOUT_MS.
  var postJson = function (endpoint, body) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CFG.REQUEST_TIMEOUT_MS) : 0;
    return fetch(CFG.API_BASE_URL + '/' + endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data };
      });
    }).then(function (r) { clearTimeout(timer); return r; }, function (err) { clearTimeout(timer); throw err; });
  };

  // ---- attempt limit (per browser tab) ---------------------------------------
  var ATTEMPTS_KEY = 'hzCheckoutAttempts';
  var memoryAttempts = 0;
  var readAttempts = function () {
    try { return Math.max(memoryAttempts, parseInt(sessionStorage.getItem(ATTEMPTS_KEY), 10) || 0); } catch (e) { return memoryAttempts; }
  };
  var countAttempt = function () {
    memoryAttempts = readAttempts() + 1;
    try { sessionStorage.setItem(ATTEMPTS_KEY, String(memoryAttempts)); } catch (e) { /* private mode: memory only */ }
    if (memoryAttempts >= CFG.MAX_ATTEMPTS) lockForm();
  };
  var clearAttempts = function () {
    memoryAttempts = 0;
    try { sessionStorage.removeItem(ATTEMPTS_KEY); } catch (e) { /* ignore */ }
  };

  // ---- page elements --------------------------------------------------------
  var seatInput = $('seatCount');
  var seatHint = $('seatHint');
  var payBtn = $('payBtn');
  var payError = $('payError');
  var cardError = $('cardError');
  var countrySelect = $('country');
  var stateSelect = $('state');
  var zipInput = $('zip');
  var honeypot = $('coWebsite');
  var readyAt = Date.now();
  var busy = false;

  // ---- seats and price ------------------------------------------------------
  var seatParam = parseInt(new URLSearchParams(window.location.search).get('seats'), 10);
  if (seatInput && seatParam > 0) seatInput.value = String(Math.min(seatParam, CFG.MAX_SEATS));

  var getSeats = function () {
    var n = seatInput ? parseInt(seatInput.value, 10) : 1;
    return n > 0 ? Math.min(n, CFG.MAX_SEATS) : 1;
  };

  // Local estimate of the LMS seat price until the API answers.
  var tierPrice = function (seats) {
    var discount = 0;
    CFG.BULK_TIERS.forEach(function (t) { if (seats >= t.min && seats <= t.max) discount = t.discount; });
    return round2(course.price * (1 - discount));
  };

  var unitPrice = courseOk ? course.price : 0;
  var priceSeats = 1;      // the seat count unitPrice belongs to
  var priceSeq = 0;        // ignores answers to older price requests
  var priceTimer = 0;

  var renderSummary = function () {
    var seats = getSeats();
    var unit = priceSeats === seats ? unitPrice : tierPrice(seats);
    var subtotal = round2(course.price * seats);
    var total = round2(unit * seats);
    var discount = round2(subtotal - total);
    setText('sumQty', seats + (seats === 1 ? ' seat' : ' seats') + ' × ' + money(course.price));
    setText('sumAmount', money(subtotal));
    setText('sumSubtotal', money(subtotal));
    show($('sumDiscountRow'), discount > 0);
    setText('sumDiscountLabel', 'Volume discount (' + Math.round((1 - unit / course.price) * 100) + '%)');
    setText('sumDiscount', '-' + money(discount));
    setText('sumTotal', money(total));
    if (payBtn && !busy) setText('payBtnText', 'Pay ' + money(total));
    return { seats: seats, unit: unit, subtotal: subtotal, total: total, discount: discount };
  };

  // Ask the LMS what it charges per seat for this many seats.
  var refreshPrice = function () {
    clearTimeout(priceTimer);
    renderSummary();
    if (!courseOk) return;
    var seats = getSeats();
    var seq = ++priceSeq;
    priceTimer = setTimeout(function () {
      postJson('roi_tier_price', { course_id: course.lmsId, quantity: seats }).then(function (r) {
        if (seq !== priceSeq) return;
        var p = r.data && r.data.success ? Number(r.data.success.price) : NaN;
        // Only accept a sane answer: never above list price, never below half of it.
        if (r.ok && isFinite(p) && p <= course.price + 0.005 && p >= course.price / 2) {
          unitPrice = round2(p);
          priceSeats = seats;
          renderSummary();
        }
      }).catch(function () { /* keep the local estimate */ });
    }, 250);
  };

  if (seatInput) {
    seatInput.addEventListener('input', function () {
      var raw = parseInt(seatInput.value, 10);
      show(seatHint, raw > CFG.MAX_SEATS);
      refreshPrice();
    });
    seatInput.addEventListener('blur', function () { seatInput.value = String(getSeats()); show(seatHint, false); });
  }

  // ---- country, state and ZIP ----------------------------------------------
  var ZIP = { US: '^\\d{5}(-\\d{4})?$', CA: '^[A-Za-z]\\d[A-Za-z][ -]?\\d[A-Za-z]\\d$' };
  var applyCountry = function () {
    if (!countrySelect || !stateSelect) return;
    var c = countrySelect.value === 'CA' ? 'CA' : 'US';
    Array.prototype.forEach.call(stateSelect.querySelectorAll('optgroup'), function (g) {
      var on = g.getAttribute('data-country') === c;
      g.hidden = !on;
      g.disabled = !on;
    });
    var chosen = stateSelect.options[stateSelect.selectedIndex];
    if (chosen && chosen.parentNode.getAttribute && chosen.parentNode.getAttribute('data-country') !== c) stateSelect.value = '';
    if (zipInput) {
      zipInput.pattern = ZIP[c];
      zipInput.title = c === 'CA' ? 'Postal code, like K1A 0B1' : 'ZIP code, like 12345 or 12345-6789';
    }
  };
  if (countrySelect) countrySelect.addEventListener('change', applyCountry);
  applyCountry();

  // ---- form checks ----------------------------------------------------------
  var NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,49}$/u;
  var EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;
  var PHONE = /^\+?[0-9 ().-]{7,25}$/;
  var checkField = function (id, ok, message) {
    var el = $(id);
    if (el) el.setCustomValidity(ok ? '' : message);
  };
  var validate = function () {
    checkField('firstName', NAME.test(value('firstName', 50)), 'Enter your first name (letters only).');
    checkField('lastName', NAME.test(value('lastName', 50)), 'Enter your last name (letters only).');
    checkField('email', EMAIL.test(value('email', 254)), 'Enter a valid email address, like you@example.com.');
    var digits = value('phone', 25).replace(/\D/g, '');
    checkField('phone', PHONE.test(value('phone', 25)) && digits.length >= 10 && digits.length <= 15, 'Enter a valid phone number with area code.');
    return form.reportValidity();
  };
  Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea'), function (el) {
    el.addEventListener('input', function () { el.setCustomValidity(''); });
  });

  // ---- busy state, errors and lock -------------------------------------------
  var warnLeave = function (e) { e.preventDefault(); e.returnValue = ''; };
  var setBusy = function (on) {
    busy = on;
    if (payBtn) {
      payBtn.disabled = on;
      show($('payBtnText'), !on);
      show($('payBtnSpinner'), on);
    }
    if (on) window.addEventListener('beforeunload', warnLeave);
    else { window.removeEventListener('beforeunload', warnLeave); renderSummary(); }
  };
  var showError = function (msg) {
    if (payError) { payError.textContent = msg; payError.hidden = false; payError.focus(); }
    setBusy(false);
  };

  function lockForm() {
    var locked = $('lockedView');
    form.hidden = true;
    show($('checkoutIntro'), false);
    if (locked) { locked.hidden = false; locked.focus(); }
  }

  // ---- Stripe ----------------------------------------------------------------
  var stripe = null;
  var card = null;
  var loadStripe = function (done) {
    if (window.Stripe) { done(); return; }
    var tag = document.createElement('script');
    tag.src = 'https://js.stripe.com/v3/';
    tag.async = true;
    tag.onload = done;
    tag.onerror = function () { showError('The card form didn’t load. Refresh the page, or enroll by phone.' + CONTACT); };
    document.head.appendChild(tag);
  };
  var mountCard = function () {
    if (card || typeof window.Stripe !== 'function') return;
    try {
      stripe = window.Stripe(CFG.STRIPE_PUBLISHABLE_KEY);
      card = stripe.elements().create('card', {
        hidePostalCode: true, // the billing ZIP above is sent with the card instead
        style: {
          base: {
            fontSize: '16px',
            color: '#14213d',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
            '::placeholder': { color: '#8a94a6' }
          },
          invalid: { color: '#b42318' }
        }
      });
      card.mount('#cardElement');
      card.on('change', function (e) {
        if (!cardError) return;
        cardError.textContent = e.error ? messageOf(e.error, '') : '';
        cardError.hidden = !e.error;
      });
    } catch (err) {
      showError('The card form didn’t load. Refresh the page, or enroll by phone.' + CONTACT);
    }
  };

  // ---- enrollment request (no card) ------------------------------------------
  var sendRequest = function () {
    if (!validate()) return;
    var p = renderSummary();
    var lines = [
      'Enrollment request from ' + ORDER_FROM,
      '',
      'Course: ' + course.name + (course.lmsId > 0 ? ' (LMS course ID ' + course.lmsId + ')' : ''),
      'Seats: ' + p.seats,
      'List price: ' + money(course.price) + ' per seat',
      'Estimated total: ' + money(p.total) + (p.discount > 0 ? ' after volume discount' : ''),
      '',
      'Name: ' + value('firstName', 50) + ' ' + value('lastName', 50),
      'Company: ' + (value('company', 100) || '-'),
      'Email: ' + value('email', 254),
      'Phone: ' + value('phone', 25)
    ];
    var notes = $('requestNotes') ? String($('requestNotes').value || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, 1000) : '';
    if (notes) lines.push('', 'Notes: ' + notes);
    var body = lines.join('\n');
    var subject = 'Enrollment request: ' + course.name + ' (' + p.seats + (p.seats === 1 ? ' seat)' : ' seats)');
    var href = 'mailto:' + CFG.ENROLL_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    setText('requestText', 'To: ' + CFG.ENROLL_EMAIL + '\nSubject: ' + subject + '\n\n' + body);
    var reopen = $('reopenEmailLink');
    if (reopen) reopen.href = href;
    form.hidden = true;
    show($('checkoutIntro'), false);
    var view = $('requestView');
    if (view) { view.hidden = false; view.focus(); }
    window.location.href = href;
  };
  var copyBtn = $('copyRequestBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var text = ($('requestText') || {}).textContent || '';
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { copyBtn.textContent = 'Copied'; }, function () {});
      }
    });
  }

  // ---- card checkout ----------------------------------------------------------
  var placeOrder = async function () {
    if (busy) return;
    if (readAttempts() >= CFG.MAX_ATTEMPTS) { lockForm(); return; }
    if (payError) payError.hidden = true;
    if (!validate()) return;

    // Bots fill the hidden field or submit within a moment of loading.
    if ((honeypot && honeypot.value !== '') || Date.now() - readyAt < CFG.MIN_FILL_MS) {
      countAttempt();
      showError('Please check your details and try again.');
      return;
    }
    if (!stripe || !card) { showError('The card form isn’t ready yet. Wait a moment and try again.' + CONTACT); return; }

    setBusy(true);
    var p = renderSummary();
    var first = value('firstName', 50);
    var last = value('lastName', 50);
    var email = value('email', 254).toLowerCase();
    var phone = value('phone', 25);
    var company = value('company', 100);
    var country = countrySelect && countrySelect.value === 'CA' ? 'CA' : 'US';
    var addr = {
      line1: value('address1', 100),
      line2: value('address2', 100),
      city: value('city', 60),
      state: value('state', 2).toUpperCase(),
      postal_code: value('zip', 10).toUpperCase(),
      country: country
    };

    // STEP 1: the card becomes a PaymentMethod inside Stripe's iframe.
    var pm;
    try {
      pm = await stripe.createPaymentMethod({
        type: 'card',
        card: card,
        billing_details: { name: first + ' ' + last, email: email, phone: phone, address: addr }
      });
    } catch (err) {
      showError(GENERIC);
      return;
    }
    if (pm.error) {
      if (pm.error.type === 'validation_error' && cardError) {
        // Incomplete or mistyped card: Stripe's message goes under the card field only.
        cardError.textContent = messageOf(pm.error, GENERIC);
        cardError.hidden = false;
        setBusy(false);
        card.focus();
        return;
      }
      if (pm.error.type === 'card_error') countAttempt();
      showError(messageOf(pm.error, GENERIC));
      return;
    }
    var paymentMethodId = pm.paymentMethod && typeof pm.paymentMethod.id === 'string' ? pm.paymentMethod.id : '';
    if (!/^pm_[A-Za-z0-9]+$/.test(paymentMethodId)) { showError(GENERIC); return; }

    // STEP 2: add_new_user -> customer id (an existing email returns its id).
    var customerId = 0;
    try {
      var userRes = await postJson('add_new_user', {
        first_name: first, last_name: last, email: email,
        user_name: first + ' ' + last, user_role_id: 2, phone: phone
      });
      var u = userRes.data;
      if (userRes.ok && u) {
        customerId = positiveId(u.user_id) ||
          positiveId(u.data && u.data.user_id) ||
          positiveId(u.success && u.success.user_id) ||
          positiveId(u.user && u.user.user_id) ||
          (u.is_duplicate ? positiveId(u.existing_email) : 0);
      }
    } catch (err) {
      // As in datacentertraining.us: add_order still runs, with customer_id 0.
    }

    // STEP 3: add_order. The LMS prices it from course_id and quantity.
    var orderId = '';
    try {
      var orderRes = await postJson('add_order', {
        customer_id: customerId,
        payment_method: 'stripe',
        payment_method_id: paymentMethodId,
        order_type: 'normal',
        order_status: 'pending',
        order_from: ORDER_FROM,
        billing_first_name: first,
        billing_last_name: last,
        billing_name: first + ' ' + last,
        billing_email: email,
        billing_phone: phone,
        billing_company: company,
        reg_company: company,
        billing_address_1: addr.line1,
        billing_address_2: addr.line2,
        billing_city: addr.city,
        billing_state: addr.state,
        billing_postcode: addr.postal_code,
        billing_country: addr.country,
        shipping_address_1: addr.line1,
        shipping_address_2: addr.line2,
        shipping_city: addr.city,
        shipping_state: addr.state,
        shipping_postcode: addr.postal_code,
        shipping_country: addr.country,
        courses: [{
          course_id: course.lmsId,
          quantity: p.seats,
          users: [{ first_name: first, last_name: last, email: email, user_name: '' }]
        }]
      });
      var d = orderRes.data;
      if (!orderRes.ok || !d || d.success === false || d.error) {
        countAttempt();
        showError(messageOf(d && d.error ? d.error : d, 'We couldn’t place your order.') + CONTACT);
        return;
      }
      orderId = String(d.order_id || d.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);

      if (typeof d.clientSecret === 'string' && d.clientSecret) {
        var confirm = await stripe.confirmCardPayment(d.clientSecret, { payment_method: paymentMethodId });
        if (confirm && confirm.error) {
          var why = messageOf(confirm.error, GENERIC);
          if (orderId) postJson('failed_status', { order_id: orderId, error: why }).catch(function () {});
          countAttempt();
          showError(why);
          return;
        }
      }
    } catch (err) {
      showError((err && err.name === 'AbortError' ? 'The payment server took too long to answer.' : 'We couldn’t reach the payment server.') +
        ' Check your email before trying again, in case the order went through.' + CONTACT);
      return;
    }

    // Done: show the confirmation only after every step succeeded.
    clearAttempts();
    setBusy(false);
    form.hidden = true;
    show($('checkoutIntro'), false);
    setText('successOrderId', orderId ? '#' + orderId : 'Confirmed');
    setText('successEmail', email);
    var done = $('successView');
    if (done) { done.hidden = false; done.focus(); }
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (requestMode) sendRequest();
    else placeOrder();
  });

  // ---- start ------------------------------------------------------------------
  if (!courseOk) {
    setText('sumName', 'Enrollment request');
  }
  if (requestMode) {
    show($('requestSection'), true);
    show($('paymentSection'), false);
    var addressFields = $('addressFields');
    if (addressFields) {
      addressFields.hidden = true;
      Array.prototype.forEach.call(addressFields.querySelectorAll('[required]'), function (el) { el.required = false; });
    }
    setText('modeNote', 'Send this request and we’ll reply by email with your order confirmation and payment options (card, or purchase order for companies).');
  } else {
    show($('requestSection'), false);
    show($('paymentSection'), true);
    if (readAttempts() >= CFG.MAX_ATTEMPTS) lockForm();
    loadStripe(mountCard);
  }
  refreshPrice();
})();
