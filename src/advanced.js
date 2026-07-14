const ejs = require('ejs');
const qs = require('qs');

const CARD_TEMPLATE = '<card><to><%= name %></to><tags><%= tags.join(",") %></tags></card>';

function renderCard(name, tags) {
  return ejs.render(CARD_TEMPLATE, { name, tags });
}

function parseGreetingQuery(queryString) {
  return qs.parse(queryString);
}

module.exports = { renderCard, parseGreetingQuery };
