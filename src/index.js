const minimist = require('minimist');
const Handlebars = require('handlebars');
const _ = require('lodash');
const decodeUriComponent = require('decode-uri-component');
const moment = require('moment');

const GREETING_TEMPLATE = 'Hello {{name}}! Today is {{date}}. Frogbot says: {{message}}';

const MESSAGES = [
  'Keep your dependencies patched.',
  'Xray scans every branch you push.',
  'Fix versions are one PR away.',
];

function decodeName(rawName) {
  try {
    return decodeUriComponent(rawName);
  } catch (err) {
    return rawName;
  }
}

function buildGreeting(name, locale) {
  const template = Handlebars.compile(GREETING_TEMPLATE);
  return template({
    name: _.escape(decodeName(name)),
    date: moment().locale(locale || 'en').format('LL'),
    message: _.sample(MESSAGES),
  });
}

function main() {
  const args = minimist(process.argv.slice(2));
  const name = args.name || 'World';
  const locale = args.locale || 'en';
  // eslint-disable-next-line no-console
  console.log(buildGreeting(name, locale));

  if (args.advanced) {
    // eslint-disable-next-line global-require
    const { renderCard, parseGreetingQuery } = require('./advanced');
    const query = parseGreetingQuery(args.query || 'tags=frogbot,xray');
    // eslint-disable-next-line no-console
    console.log(renderCard(name, (query.tags || '').split(',')));
  }

  if (args.i18n) {
    // eslint-disable-next-line global-require
    const { localizedSuffix } = require('./i18n');
    // eslint-disable-next-line no-console
    console.log(localizedSuffix(locale));
  }
}

main();

module.exports = { buildGreeting };
