
# Post-it Social App

Application de post-it sociale construite avec Node.js et Express.

## Description

Application permettant aux utilisateurs de créer, modifier et gérer des post-its de manière collaborative. Gestion des rôles et permissions pour admin, utilisateurs standards et invités.

## Prérequis

- Node.js (v14+)
- npm ou yarn

## Installation

1. Cloner le repository :

```bash
git clone https://github.com/hichemaouane/projet-postit.git
cd projet-postit
```

2. Installer les dépendances :

```bash
npm install
```

3. Configurer les variables d'environnement :

```bash
cp .env.example .env
# Windows PowerShell:
# Copy-Item .env.example .env
```

4. Démarrer le serveur :

```bash
npm start
```

Pour le développement avec auto-rechargement :

```bash
npm run dev
```

## Déploiement sur Render

- Start Command recommandé : `npm start`
- Le serveur initialise automatiquement la base SQLite au démarrage (création des tables manquantes + migration `tableau_id`).
- Si vous utilisez SQLite en production, configurez un disque persistant Render et stockez le fichier de base dessus pour éviter la perte des données entre redéploiements.

## Accès

Le serveur s'exécute par défaut sur `http://localhost:3000`

## Fonctionnalités

- Authentification utilisateur (avec bcryptjs)
- Gestion des sessions (SQLite)
- Système de rôles et permissions
- CSRF protection
- Sécurité améliorée (Helmet)
- Base de données SQLite

## Stack Technologique

- **Backend** : Node.js, Express.js
- **Database** : SQLite3
- **Authentification** : bcryptjs
- **Sessions** : express-session
- **Sécurité** : Helmet, csurf
- **Template Engine** : EJS

## Dépendances

Voir [package.json](package.json) pour la liste complète des dépendances.

## Structure du Projet

```
.
├── public/              # Fichiers statiques
│   ├── css/
│   └── js/
├── views/               # Templates EJS
├── server.js            # Point d'entrée
├── package.json         # Dépendances
└── README.md           # Documentation
```
