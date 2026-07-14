const Y18N = require('y18n');

const y18n = Y18N({ locale: 'en', updateFiles: false });

y18n.cache.en = {
  'greeting-suffix': 'Stay patched!',
};

function localizedSuffix(locale) {
  y18n.setLocale(locale || 'en');
  return y18n.__('greeting-suffix');
}

module.exports = { localizedSuffix };
