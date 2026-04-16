require('dotenv').config();
const path = require('path');

var knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: path.join(__dirname, 'postit.db')
    },
    useNullAsDefault: true
});

module.exports = knex;
