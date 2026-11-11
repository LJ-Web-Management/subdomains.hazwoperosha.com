// Checkout settings for every site, served to each one at /_shared/config.js.
// The same values as datacentertraining.us (js/config.js) and hazwoper-osha.com's
// own checkout page, so orders land in the hazwoper-osha.com LMS the same way.
//
// Each site's course (LMS id, price, name) is on its checkout.html form, written
// by scripts/build-checkout.py from data/courses.json. Never put a Stripe secret
// key (sk_...) or restricted key (rk_...) here: this file is public.
var HZ_CHECKOUT = (function () {
  'use strict';
  var deepFreeze = function (o) {
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); });
    return Object.freeze(o);
  };
  return deepFreeze({
    // PRODUCTION. A publishable key is safe to publish; it can only create
    // PaymentMethods, not charge or read anything.
    STRIPE_PUBLISHABLE_KEY: 'pk_live_doCHB0jglD5eISjEmB1vB6mb00xIg51noK',
    API_BASE_URL: 'https://hazwoper-osha.com/api',

    // true: send every order as an enrollment-request email instead of
    // charging a card (as CHECKOUT_DISABLED in datacentertraining.us).
    CHECKOUT_DISABLED: false,

    // order_from is "<site>.hazwoperosha.com", so each sale shows where it came from.
    ROOT_DOMAIN: 'hazwoperosha.com',
    ENROLL_EMAIL: 'info@hazwoper-osha.com',
    PHONE: '1-866-429-6742',
    PHONE_HREF: 'tel:+18664296742',

    // hazwoper-osha.com takes 1-999 seats per course.
    MAX_SEATS: 999,
    // Failed card or order attempts allowed per browser tab before the form
    // locks and asks the buyer to call. Slows down card-testing bots.
    MAX_ATTEMPTS: 5,
    // Faster than this from page load to Place Order is a bot, not a person.
    MIN_FILL_MS: 3000,
    REQUEST_TIMEOUT_MS: 30000,

    // Seat-count discount ladder, used only while the live LMS price
    // (POST /api/roi_tier_price) hasn't answered. Matches what that API returned
    // on 2026-11-11: no tier below 2 seats or above 250.
    BULK_TIERS: [
      { min: 2, max: 10, discount: 0.01 },
      { min: 11, max: 20, discount: 0.02 },
      { min: 21, max: 50, discount: 0.03 },
      { min: 51, max: 100, discount: 0.05 },
      { min: 101, max: 250, discount: 0.07 }
    ]
  });
})();
