// script pour initialiser la base de données MySQL
// lancer une seule fois: node setup.js

require("dotenv").config();
var db = require("./db");
var bcrypt = require("bcryptjs");
var fs = require("fs");
var crypto = require("crypto");

// générer un mot de passe sécurisé aléatoire
function generateSecurePassword() {
  var upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var lower = "abcdefghijklmnopqrstuvwxyz";
  var digits = "0123456789";
  var special = "!@#$%^&*()_+-=[]{}|;:,.<>?";

  var password = "";
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += digits[Math.floor(Math.random() * digits.length)];
  password += special[Math.floor(Math.random() * special.length)];

  var allChars = upper + lower + digits + special;
  for (var i = 0; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // mélanger les caractères
  return password
    .split("")
    .sort(function () {
      return Math.random() - 0.5;
    })
    .join("");
}

async function init() {
  console.log("Initialisation de la base de données...");

  // créer la table users
  var hasUsers = await db.schema.hasTable("users");
  if (!hasUsers) {
    await db.schema.createTable("users", function (t) {
      t.increments("id").primary();
      t.string("username", 50).unique().notNullable();
      t.string("password", 255).notNullable();
      t.tinyint("can_create").defaultTo(1).notNullable();
      t.tinyint("can_edit").defaultTo(1).notNullable();
      t.tinyint("can_delete").defaultTo(1).notNullable();
      t.tinyint("can_admin").defaultTo(0).notNullable();
    });
    console.log("Table users créée");
  } else {
    console.log("Table users existe déjà");
  }

  // créer la table postits
  var hasPostits = await db.schema.hasTable("postits");
  if (!hasPostits) {
    await db.schema.createTable("postits", function (t) {
      t.increments("id").primary();
      t.text("texte").notNullable();
      t.datetime("created_at").defaultTo(db.fn.now());
      t.integer("x").notNullable().defaultTo(0);
      t.integer("y").notNullable().defaultTo(0);
      t.integer("z_index").defaultTo(0);
      t.integer("auteur_id").unsigned().notNullable();
      t.foreign("auteur_id").references("id").inTable("users");
    });
    console.log("Table postits créée");
  } else {
    console.log("Table postits existe déjà");
  }

  // créer l'utilisateur guest (droits zéro)
  var guest = await db("users").where("username", "guest").first();
  if (!guest) {
    await db("users").insert({
      username: "guest",
      password: "PAS_DE_MOT_DE_PASSE",
      can_create: 0,
      can_edit: 0,
      can_delete: 0,
      can_admin: 0,
    });
    console.log("Utilisateur guest créé");
  }

  // créer l'administrateur par défaut
  var admin = await db("users").where("username", "admin").first();
  if (!admin) {
    // générer un mot de passe sécurisé aléatoire
    var adminPassword = process.env.ADMIN_PASSWORD || generateSecurePassword();
    var hash = bcrypt.hashSync(adminPassword, 12);
    await db("users").insert({
      username: "admin",
      password: hash,
      can_create: 1,
      can_edit: 1,
      can_delete: 1,
      can_admin: 1,
    });
    console.log("\n=== ADMIN CRÉÉ ===");
    console.log("Utilisateur: admin");
    console.log("Mot de passe: " + adminPassword);
    console.log("⚠️  SAUVEGARDEZ CE MOT DE PASSE DANS UN ENDROIT SÛR");
    console.log("⚠️  IL NE SERA PAS RÉAFFICHABLE\n");

    // sauvegarder dans un fichier .admin.txt sécurisé
    fs.writeFileSync(
      ".admin.txt",
      "Admin credentials:\nUsername: admin\nPassword: " + adminPassword + "\n",
      { mode: 0o600 },
    );
    console.log("Credentials sauvegardées dans .admin.txt (mode 600)\n");
  }

  console.log("\nBase de données prête. Lancez: node server.js");
  process.exit(0);
}

init().catch(function (err) {
  console.error("Erreur lors du setup:", err.message);
  process.exit(1);
});
