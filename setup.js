// script pour initialiser la base de données MySQL
// lancer une seule fois: node setup.js

require('dotenv').config();
var db = require('./db');
var bcrypt = require('bcryptjs');

async function init() {
    console.log('Initialisation de la base de données...');

    // créer la table users
    var hasUsers = await db.schema.hasTable('users');
    if (!hasUsers) {
        await db.schema.createTable('users', function(t) {
            t.increments('id').primary();
            t.string('username', 50).unique().notNullable();
            t.string('password', 255).notNullable();
            t.tinyint('can_create').defaultTo(1).notNullable();
            t.tinyint('can_edit').defaultTo(1).notNullable();
            t.tinyint('can_delete').defaultTo(1).notNullable();
            t.tinyint('can_admin').defaultTo(0).notNullable();
        });
        console.log('Table users créée');
    } else {
        console.log('Table users existe déjà');
    }

    // créer la table postits
    var hasPostits = await db.schema.hasTable('postits');
    if (!hasPostits) {
        await db.schema.createTable('postits', function(t) {
            t.increments('id').primary();
            t.text('texte').notNullable();
            t.datetime('created_at').defaultTo(db.fn.now());
            t.integer('x').notNullable().defaultTo(0);
            t.integer('y').notNullable().defaultTo(0);
            t.integer('z_index').defaultTo(0);
            t.integer('auteur_id').unsigned().notNullable();
            t.foreign('auteur_id').references('id').inTable('users');
        });
        console.log('Table postits créée');
    } else {
        console.log('Table postits existe déjà');
    }

    // créer l'utilisateur guest (droits zéro)
    var guest = await db('users').where('username', 'guest').first();
    if (!guest) {
        await db('users').insert({
            username: 'guest',
            password: 'PAS_DE_MOT_DE_PASSE',
            can_create: 0,
            can_edit: 0,
            can_delete: 0,
            can_admin: 0
        });
        console.log('Utilisateur guest créé');
    }

    // créer l'administrateur par défaut
    var admin = await db('users').where('username', 'admin').first();
    if (!admin) {
        var hash = bcrypt.hashSync('Admin1234!', 12);
        await db('users').insert({
            username: 'admin',
            password: hash,
            can_create: 1,
            can_edit: 1,
            can_delete: 1,
            can_admin: 1
        });
        console.log('Admin créé - login: admin  /  mot de passe: Admin1234!');
        console.log('PENSEZ A CHANGER CE MOT DE PASSE !');
    }

    console.log('\nBase de données prête. Lancez: node server.js');
    process.exit(0);
}

init().catch(function(err) {
    console.error('Erreur lors du setup:', err.message);
    process.exit(1);
});
