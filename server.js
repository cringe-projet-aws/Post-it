require('dotenv').config();

const express = require('express');
var app = express();
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const bcrypt = require('bcryptjs');
var session = require('express-session');
const helmet = require('helmet');
var csrf = require('csurf');
var flash = require('connect-flash');
const rateLimit = require('express-rate-limit');
const db = require('./db');

var PORT = process.env.PORT || 3000;

// vérifier si les certificats SSL existent
var certOptions = null;
try {
    certOptions = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.cert'))
    };
    console.log('Certificats SSL trouvés, HTTPS activé');
} catch (e) {
    console.log('Pas de certificats SSL - mode HTTP (développement)');
}

// configuration du moteur de vues
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// fichiers statiques (CSS, JS client)
app.use(express.static(path.join(__dirname, 'public')));

// entêtes de sécurité HTTP avec Helmet
// on désactive CSP pour autoriser les scripts inline
app.use(helmet({ contentSecurityPolicy: false }));

// parser les données des formulaires POST
app.use(express.urlencoded({ extended: false }));
// parser le JSON (pour les requêtes AJAX)
app.use(express.json());

// configuration des sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'notree_cle_par_défaut',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: certOptions !== null,
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 8
    }
}));

// protection CSRF (après la session)
app.use(csrf());

// messages flash (erreurs, succès)
app.use(flash());

// rendre les variables disponibles dans tous les templates EJS
app.use(function (req, res, next) {
    res.locals.user = req.session.user || null;
    res.locals.csrfToken = req.csrfToken();
    res.locals.erreur = req.flash('erreur');
    res.locals.succes = req.flash('succes');
    next();
});

// anti brute-force sur la page de connexion
var loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.'
});

// vérifier si l'utilisateur est connecté
function requireLogin(req, res, next) {
    if (!req.session.user) {
        var isAjax = req.headers['content-type'] && req.headers['content-type'].indexOf('application/json') != -1;
        if (isAjax) {
            return res.status(401).json({ ok: false, message: 'Non connecté' });
        }
        req.flash('erreur', 'Vous devez être connecté');
        return res.redirect('/default');
    }
    next();
}

// ========================
//        ROUTES
// ========================

// initialisation/migration de la base pour les environnements ne lançant pas setup.js
async function initialiserBase() {
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
        console.log('Table users créée automatiquement');
    }

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
        console.log('Table postits créée automatiquement');
    }

    var cols = await db('postits').columnInfo();
    if (!cols.tableau_id) {
        await db.schema.table('postits', function(t) {
            t.string('tableau_id', 100).notNullable().defaultTo('default');
        });
        console.log('Colonne tableau_id ajoutée à postits');
    }

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
        console.log('Utilisateur guest créé automatiquement');
    }

    var admin = await db('users').where('username', 'admin').first();
    if (!admin) {
        var adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
        var hash = bcrypt.hashSync(adminPassword, 12);
        await db('users').insert({
            username: 'admin',
            password: hash,
            can_create: 1,
            can_edit: 1,
            can_delete: 1,
            can_admin: 1
        });
        console.log('Admin par défaut créé automatiquement');
        if (!process.env.ADMIN_PASSWORD) {
            console.warn('⚠️  ADMIN_PASSWORD non défini dans .env - mot de passe par défaut utilisé');
        }
    }
}

// valider un identifiant de tableau
function slugValide(slug) {
    return /^[a-z0-9_-]{1,50}$/.test(slug);
}

// page principale -> redirige vers le tableau par défaut
app.get('/', function (req, res) {
    res.redirect('/default');
});

// liste des postits en JSON (pour AJAX) - filtré par tableau
app.get('/liste', async function (req, res) {
    var board = (req.query.board || 'default').toLowerCase();
    if (!slugValide(board)) board = 'default';
    try {
        var postits = await db('postits')
            .join('users', 'postits.auteur_id', 'users.id')
            .select('postits.*', 'users.username as auteur_nom')
            .where('postits.tableau_id', board)
            .orderBy('postits.z_index', 'asc');
        res.json({ ok: true, postits: postits });
    } catch (err) {
        console.log(err.message);
        res.status(500).json({ ok: false });
    }
});

// page d'inscription
app.get('/signup', function (req, res) {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('signup');
});

// traitement de l'inscription
app.post('/signup', async function (req, res) {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';
    var confirm = req.body.confirm || '';

    // vérifications de base
    if (username.length < 3 || username.length > 30) {
        req.flash('erreur', 'Le nom doit faire entre 3 et 30 caractères');
        return res.redirect('/signup');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        req.flash('erreur', 'Nom invalide : lettres, chiffres et _ seulement');
        return res.redirect('/signup');
    }
    if (username.toLowerCase() === 'guest' || username.toLowerCase() === 'admin') {
        req.flash('erreur', 'Ce nom est réservé');
        return res.redirect('/signup');
    }
    // vérifier la longueur minimale
    if (password.length < 8) {
        req.flash('erreur', 'Mot de passe trop court (minimum 8 caractères)');
        return res.redirect('/signup');
    }
    // vérifier qu'il y a au moins une lettre majuscule
    if (!/[A-Z]/.test(password)) {
        req.flash('erreur', 'Le mot de passe doit contenir au moins une majuscule');
        return res.redirect('/signup');
    }
    // vérifier qu'il y a au moins une lettre minuscule
    if (!/[a-z]/.test(password)) {
        req.flash('erreur', 'Le mot de passe doit contenir au moins une minuscule');
        return res.redirect('/signup');
    }
    // vérifier qu'il y a au moins un chiffre
    if (!/[0-9]/.test(password)) {
        req.flash('erreur', 'Le mot de passe doit contenir au moins un chiffre');
        return res.redirect('/signup');
    }
    if (password !== confirm) {
        req.flash('erreur', 'Les mots de passe ne correspondent pas');
        return res.redirect('/signup');
    }

    try {
        // vérifier que le nom n'est pas déjà utilisé
        var existing = await db('users').where('username', username).first();
        if (existing) {
            req.flash('erreur', 'Ce nom d\'utilisateur est déjà pris');
            return res.redirect('/signup');
        }

        var hash = bcrypt.hashSync(password, 12);
        await db('users').insert({
            username: username,
            password: hash,
            can_create: 1,
            can_edit: 1,
            can_delete: 1,
            can_admin: 0
        });
        req.flash('succes', 'Compte créé avec succès ! Connectez-vous.');
        res.redirect('/');
    } catch (err) {
        console.log('Erreur inscription:', err.message);
        req.flash('erreur', 'Erreur lors de la création du compte');
        res.redirect('/signup');
    }
});

// connexion
app.post('/login', loginLimiter, async function (req, res) {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
        req.flash('erreur', 'Remplissez tous les champs');
        return res.redirect('/default');
    }

    try {
        var user = await db('users').where('username', username).first();

        // message d'erreur générique (on ne dit pas si le compte existe)
        if (!user || user.username === 'guest') {
            req.flash('erreur', 'Identifiants incorrects');
            return res.redirect('/default');
        }

        var mdpOk = bcrypt.compareSync(password, user.password);
        if (!mdpOk) {
            req.flash('erreur', 'Identifiants incorrects');
            return res.redirect('/default');
        }

        // régénérer l'ID de session pour éviter la fixation de session
        req.session.regenerate(function (err) {
            if (err) {
                console.log('Erreur regenerate:', err);
                req.flash('erreur', 'Erreur serveur');
                return res.redirect('/default');
            }
            req.session.user = {
                id: user.id,
                username: user.username,
                can_create: user.can_create == 1,
                can_edit: user.can_edit == 1,
                can_delete: user.can_delete == 1,
                can_admin: user.can_admin == 1
            };
            req.session.save(function (saveErr) {
                res.redirect('/default');
            });
        });
    } catch (err) {
        console.log('Erreur login:', err.message);
        req.flash('erreur', 'Erreur serveur');
        res.redirect('/default');
    }
});

// déconnexion
app.get('/logout', function (req, res) {
    req.session.destroy(function (err) {
        res.redirect('/default');
    });
});



// ajouter un postit (AJAX)
app.post('/ajouter', requireLogin, async function (req, res) {
    var user = req.session.user;

    if (!user.can_create) {
        return res.status(403).json({ ok: false, message: 'Vous n\'avez pas la permission de créer des postits' });
    }

    var texte = (req.body.texte || '').trim();
    var x = parseInt(req.body.x) || 0;
    var y = parseInt(req.body.y) || 0;
    var board = (req.body.board || 'default').toLowerCase();
    if (!slugValide(board)) board = 'default';

    if (texte.length === 0) {
        return res.status(400).json({ ok: false, message: 'Le texte est vide' });
    }
    if (texte.length > 500) {
        return res.status(400).json({ ok: false, message: 'Texte trop long (500 caractères max)' });
    }
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    try {
        // calculer le z_index pour afficher le nouveau postit au dessus
        var res2 = await db('postits').where('tableau_id', board).max('z_index as max').first();
        var nextZ = (res2.max || 0) + 1;

        var newIds = await db('postits').insert({
            texte: texte,
            x: x,
            y: y,
            z_index: nextZ,
            auteur_id: user.id,
            tableau_id: board
        });

        // récupérer le postit complet avec le nom de l'auteur
        var nouveau = await db('postits')
            .join('users', 'postits.auteur_id', 'users.id')
            .select('postits.*', 'users.username as auteur_nom')
            .where('postits.id', newIds[0])
            .first();

        res.json({ ok: true, postit: nouveau });
    } catch (err) {
        console.log('Erreur /ajouter:', err.message);
        res.status(500).json({ ok: false });
    }
});

// supprimer un postit (AJAX)
app.post('/effacer', requireLogin, async function (req, res) {
    var user = req.session.user;

    if (!user.can_delete) {
        return res.status(403).json({ ok: false, message: 'Pas la permission de supprimer' });
    }

    var id = parseInt(req.body.id);
    if (!id || id <= 0) {
        return res.status(400).json({ ok: false, message: 'ID invalide' });
    }

    try {
        var postit = await db('postits').where('id', id).first();
        if (!postit) {
            return res.status(404).json({ ok: false, message: 'Postit introuvable' });
        }
        // vérifier que c'est son postit ou qu'il est admin
        if (postit.auteur_id != user.id && !user.can_admin) {
            return res.status(403).json({ ok: false, message: 'Ce postit ne vous appartient pas' });
        }
        await db('postits').where('id', id).del();
        res.json({ ok: true });
    } catch (err) {
        console.log('Erreur /effacer:', err.message);
        res.status(500).json({ ok: false });
    }
});

// modifier le texte d'un postit (AJAX)
app.post('/modifier', requireLogin, async function (req, res) {
    var user = req.session.user;

    if (!user.can_edit) {
        return res.status(403).json({ ok: false, message: 'Pas la permission de modifier' });
    }

    var id = parseInt(req.body.id);
    var texte = (req.body.texte || '').trim();

    if (!id || id <= 0) {
        return res.status(400).json({ ok: false, message: 'ID invalide' });
    }
    if (texte.length === 0 || texte.length > 500) {
        return res.status(400).json({ ok: false, message: 'Texte invalide' });
    }

    try {
        var postit = await db('postits').where('id', id).first();
        if (!postit) {
            return res.status(404).json({ ok: false, message: 'Postit introuvable' });
        }
        if (postit.auteur_id != user.id && !user.can_admin) {
            return res.status(403).json({ ok: false, message: 'Ce postit ne vous appartient pas' });
        }
        await db('postits').where('id', id).update({ texte: texte });
        res.json({ ok: true });
    } catch (err) {
        console.log('Erreur /modifier:', err.message);
        res.status(500).json({ ok: false });
    }
});

// déplacer un postit - drag and drop (AJAX)
app.post('/deplacer', requireLogin, async function (req, res) {
    var user = req.session.user;
    var id = parseInt(req.body.id);
    var x = parseInt(req.body.x);
    var y = parseInt(req.body.y);
    var board = (req.body.board || 'default').toLowerCase();
    if (!slugValide(board)) board = 'default';

    if (!id || isNaN(x) || isNaN(y)) {
        return res.status(400).json({ ok: false, message: 'Données invalides' });
    }
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    try {
        var postit = await db('postits').where('id', id).first();
        if (!postit) {
            return res.status(404).json({ ok: false });
        }
        if (postit.auteur_id != user.id && !user.can_admin) {
            return res.status(403).json({ ok: false });
        }
        // passer en avant plan quand on déplace
        var res3 = await db('postits').where('tableau_id', board).max('z_index as max').first();
        var nextZ = (res3.max || 0) + 1;
        await db('postits').where('id', id).update({ x: x, y: y, z_index: nextZ });
        res.json({ ok: true });
    } catch (err) {
        console.log('Erreur /deplacer:', err.message);
        res.status(500).json({ ok: false });
    }
});

// ========================
//    PAGE ADMINISTRATION
// ========================

app.get('/admin', requireLogin, async function (req, res) {
    if (!req.session.user.can_admin) {
        return res.status(403).send('Accès refusé - administrateurs uniquement');
    }
    try {
        var users = await db('users').whereNot('username', 'guest').orderBy('id', 'asc');
        res.render('admin', { users: users });
    } catch (err) {
        console.log('Erreur /admin:', err.message);
        res.status(500).send('Erreur serveur');
    }
});

app.post('/admin/update', requireLogin, async function (req, res) {
    if (!req.session.user.can_admin) {
        return res.status(403).send('Accès refusé');
    }

    var userId = parseInt(req.body.userId);
    if (!userId || userId <= 0) {
        req.flash('erreur', 'ID utilisateur invalide');
        return res.redirect('/admin');
    }

    try {
        var target = await db('users').where('id', userId).first();
        if (!target || target.username === 'guest') {
            req.flash('erreur', 'Impossible de modifier cet utilisateur');
            return res.redirect('/admin');
        }

        var estSoi = userId == req.session.user.id;
        var can_create = req.body.can_create ? 1 : 0;
        var can_edit = req.body.can_edit ? 1 : 0;
        var can_delete = req.body.can_delete ? 1 : 0;
        // on ne peut pas se retirer ses propres droits admin
        var can_admin = estSoi ? 1 : (req.body.can_admin ? 1 : 0);

        await db('users').where('id', userId).update({
            can_create: can_create,
            can_edit: can_edit,
            can_delete: can_delete,
            can_admin: can_admin
        });

        // mettre à jour la session si on modifie ses propres permissions
        if (estSoi) {
            req.session.user.can_create = can_create == 1;
            req.session.user.can_edit = can_edit == 1;
            req.session.user.can_delete = can_delete == 1;
        }

        req.flash('succes', 'Permissions de ' + target.username + ' mises à jour');
        res.redirect('/admin');
    } catch (err) {
        console.log('Erreur /admin/update:', err.message);
        req.flash('erreur', 'Erreur lors de la mise à jour');
        res.redirect('/admin');
    }
});

app.post('/admin/delete', requireLogin, async function (req, res) {
    if (!req.session.user.can_admin) {
        return res.status(403).send('Accès refusé');
    }

    var userId = parseInt(req.body.userId);
    if (!userId || userId <= 0) {
        req.flash('erreur', 'ID utilisateur invalide');
        return res.redirect('/admin');
    }

    try {
        var target = await db('users').where('id', userId).first();
        if (!target) {
            req.flash('erreur', 'Utilisateur introuvable');
            return res.redirect('/admin');
        }

        // protection: ne pas supprimer les utilisateurs système
        if (target.username === 'guest' || target.username === 'admin') {
            req.flash('erreur', 'Impossible de supprimer cet utilisateur système');
            return res.redirect('/admin');
        }

        // protection: un admin ne peut pas se supprimer lui-même
        if (target.id === req.session.user.id) {
            req.flash('erreur', 'Vous ne pouvez pas supprimer votre propre compte');
            return res.redirect('/admin');
        }

        // supprimer d'abord tous les postits de l'utilisateur
        await db('postits').where('auteur_id', userId).del();
        // puis supprimer l'utilisateur
        await db('users').where('id', userId).del();

        req.flash('succes', 'Utilisateur ' + target.username + ' supprimé avec succès');
        res.redirect('/admin');
    } catch (err) {
        console.log('Erreur /admin/delete:', err.message);
        req.flash('erreur', 'Erreur lors de la suppression');
        res.redirect('/admin');
    }
});


// tableau nommé - doit être après toutes les routes fixes
app.get('/:board', async function (req, res) {
    var board = (req.params.board || 'default').toLowerCase();
    if (!slugValide(board)) {
        return res.status(400).send('Nom de tableau invalide (lettres minuscules, chiffres, - et _ uniquement)');
    }
    try {
        var postits = await db('postits')
            .join('users', 'postits.auteur_id', 'users.id')
            .select('postits.*', 'users.username as auteur_nom')
            .where('postits.tableau_id', board)
            .orderBy('postits.z_index', 'asc')
            .orderBy('postits.created_at', 'asc');

        res.render('index', { postits: postits, board: board });
    } catch (err) {
        console.log('Erreur GET /:board:', err.message);
        res.status(500).send('Erreur serveur');
    }
});


// gestionnaire d'erreur global (doit être après toutes les routes)
app.use(function (err, req, res, next) {
    if (err.code === 'EBADCSRFTOKEN') {
        var isAjax = req.headers['content-type'] && req.headers['content-type'].indexOf('application/json') != -1;
        if (isAjax) {
            return res.status(403).json({ ok: false, message: 'Token invalide, rechargez la page' });
        }
        return res.status(403).send('Requête invalide - rechargez la page');
    }
    console.log('Erreur non gérée:', err.message);
    res.status(500).send('Erreur serveur');
});


// ========================
//   DÉMARRAGE DU SERVEUR
// ========================

if (certOptions) {
    initialiserBase().then(function () {
        // lancer en HTTPS
        https.createServer(certOptions, app).listen(PORT, function () {
            console.log('Serveur HTTPS démarré sur https://localhost:' + PORT);
        });
        // rediriger les connexions HTTP vers HTTPS
        http.createServer(function (req, res) {
            var host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
            res.writeHead(301, { 'Location': 'https://' + host + ':' + PORT + req.url });
            res.end();
        }).listen(3001, function () {
            console.log('Redirection HTTP (port 3001) -> HTTPS (port ' + PORT + ')');
        });
    }).catch(function (err) {
        console.error('Erreur initialisation base:', err.message);
        process.exit(1);
    });
} else {
    initialiserBase().then(function () {
        app.listen(PORT, function () {
            console.log('Serveur démarré sur http://localhost:' + PORT);
        });
    }).catch(function (err) {
        console.error('Erreur initialisation base:', err.message);
        process.exit(1);
    });
}
