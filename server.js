require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const flash = require("connect-flash");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup (SQLite for simplicity)
const db = new sqlite3.Database(path.join(__dirname, "postits.db"));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', -- user, admin, guest
      can_create INTEGER NOT NULL DEFAULT 1,
      can_edit INTEGER NOT NULL DEFAULT 1,
      can_delete INTEGER NOT NULL DEFAULT 1,
      can_admin INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS postits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      z_index INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER NOT NULL,
      board TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (author_id) REFERENCES users(id)
    )
  `);

  // Create special guest user if not exists
  db.run(
    `INSERT OR IGNORE INTO users (username, password_hash, role, can_create, can_edit, can_delete, can_admin)
     VALUES ('guest', '', 'guest', 0, 0, 0, 0)`,
  );

  // Pre-configure admin user (and remove other admins created manually)
  // Admin credentials:
  // username: admin
  // password: admin123*
  const adminHash = bcrypt.hashSync("admin123*", 10);

  // Delete any other admins (keep 'admin' and 'guest')
  db.run(`DELETE FROM users WHERE role = 'admin' AND username <> 'admin'`);

  // Ensure 'admin' exists and has admin rights
  db.run(
    `
    INSERT OR IGNORE INTO users (username, password_hash, role, can_create, can_edit, can_delete, can_admin)
    VALUES ('admin', ?, 'admin', 1, 1, 1, 1)
  `,
    [adminHash],
  );

  // If 'admin' already exists, force-update its password and rights
  db.run(
    `
    UPDATE users
    SET password_hash = ?,
        role = 'admin',
        can_create = 1,
        can_edit = 1,
        can_delete = 1,
        can_admin = 1
    WHERE username = 'admin'
  `,
    [adminHash],
  );
});

// View engine & static files
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Security & parsing
// Note: Helmet active CSP blocks inline scripts; we use a tiny inline script
// to expose CURRENT_USER to the client, so we disable CSP for this project.
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: "sessions.db", dir: __dirname }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

app.use(flash());

// Expose user & flashes to all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.messages = {
    error: req.flash("error"),
    success: req.flash("success"),
  };
  next();
});

// Middleware helpers
function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.xhr || req.headers.accept?.includes("application/json")) {
      return res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    }
    req.flash("error", "Vous devez être connecté.");
    return res.redirect("/");
  }
  next();
}

// Routes

// GET /signup - registration form
app.get("/signup", (req, res) => {
  res.render("signup");
});

// POST /signup - create user
app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash("error", "Nom d’utilisateur et mot de passe requis.");
    return res.redirect("/signup");
  }

  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
    [username, hash],
    function (err) {
      if (err) {
        console.error(err);
        req.flash(
          "error",
          "Impossible de créer l'utilisateur (nom déjà utilisé ?)",
        );
        return res.redirect("/signup");
      }
      req.flash("success", "Compte créé, vous pouvez vous connecter.");
      res.redirect("/");
    },
  );
});

// POST /login - login user
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash("error", "Nom d’utilisateur et mot de passe requis.");
    return res.redirect("/");
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err) {
      console.error(err);
      req.flash("error", "Erreur serveur.");
      return res.redirect("/");
    }
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      req.flash("error", "Identifiants invalides.");
      return res.redirect("/");
    }

    // Store minimal user info in session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      can_create: !!user.can_create,
      can_edit: !!user.can_edit,
      can_delete: !!user.can_delete,
      can_admin: !!user.can_admin,
    };
    req.flash("success", "Connecté avec succès.");
    res.redirect("/");
  });
});

// GET / - main page default board
app.get("/", (req, res) => {
  const board = "default";
  db.all(
    `
    SELECT p.*, u.username AS author_name
    FROM postits p
    JOIN users u ON p.author_id = u.id
    WHERE p.board = ?
    ORDER BY p.z_index ASC, p.created_at ASC
  `,
    [board],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Erreur serveur");
      }
      res.render("index", { board, postits: rows });
    },
  );
});

// GET /logout - logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// POST /ajouter - add post-it (AJAX)
app.post("/ajouter", requireAuth, (req, res) => {
  const user = req.session.user;
  if (!user.can_create) {
    return res.status(403).json({ ok: false, error: "NO_CREATE_PERMISSION" });
  }

  const { text, x, y, board } = req.body;
  if (!text || x == null || y == null) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  const boardName = board || "default";

  // Compute next z_index
  db.get(
    `SELECT IFNULL(MAX(z_index), 0) + 1 AS next_z FROM postits WHERE board = ?`,
    [boardName],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ ok: false, error: "DB_ERROR" });
      }
      const nextZ = row?.next_z || 1;
      db.run(
        `
        INSERT INTO postits (text, x, y, z_index, author_id, board)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        [text, x, y, nextZ, user.id, boardName],
        function (err2) {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ ok: false, error: "DB_ERROR" });
          }

          db.get(
            `
            SELECT p.*, u.username AS author_name
            FROM postits p
            JOIN users u ON p.author_id = u.id
            WHERE p.id = ?
          `,
            [this.lastID],
            (err3, newPostit) => {
              if (err3) {
                console.error(err3);
                return res.status(500).json({ ok: false, error: "DB_ERROR" });
              }
              res.json({ ok: true, postit: newPostit });
            },
          );
        },
      );
    },
  );
});

// POST /effacer - delete post-it (AJAX)
app.post("/effacer", requireAuth, (req, res) => {
  const user = req.session.user;
  if (!user.can_delete) {
    return res.status(403).json({ ok: false, error: "NO_DELETE_PERMISSION" });
  }
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: "MISSING_ID" });
  }

  db.get(`SELECT * FROM postits WHERE id = ?`, [id], (err, postit) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
    if (!postit) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const isOwner = postit.author_id === user.id;
    const isAdmin = user.can_admin || user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    db.run(`DELETE FROM postits WHERE id = ?`, [id], function (err2) {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ ok: false, error: "DB_ERROR" });
      }
      res.json({ ok: true });
    });
  });
});

// POST /modifier - edit post-it (AJAX)
app.post("/modifier", requireAuth, (req, res) => {
  const user = req.session.user;
  if (!user.can_edit) {
    return res.status(403).json({ ok: false, error: "NO_EDIT_PERMISSION" });
  }
  const { id, text } = req.body;
  if (!id || !text) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  db.get(`SELECT * FROM postits WHERE id = ?`, [id], (err, postit) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
    if (!postit) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const isOwner = postit.author_id === user.id;
    const isAdmin = user.can_admin || user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    db.run(
      `UPDATE postits SET text = ? WHERE id = ?`,
      [text, id],
      function (err2) {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ ok: false, error: "DB_ERROR" });
        }
        res.json({ ok: true });
      },
    );
  });
});

// POST /deplacer - drag&drop move post-it (AJAX)
app.post("/deplacer", requireAuth, (req, res) => {
  const user = req.session.user;
  const { id, x, y } = req.body;
  if (!id || x == null || y == null) {
    return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
  }

  db.get(`SELECT * FROM postits WHERE id = ?`, [id], (err, postit) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
    if (!postit) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const isOwner = postit.author_id === user.id;
    const isAdmin = user.can_admin || user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, error: "NOT_OWNER" });
    }

    // New z_index on move
    db.get(
      `SELECT IFNULL(MAX(z_index), 0) + 1 AS next_z FROM postits WHERE board = ?`,
      [postit.board],
      (err2, row) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ ok: false, error: "DB_ERROR" });
        }
        const nextZ = row?.next_z || 1;
        db.run(
          `UPDATE postits SET x = ?, y = ?, z_index = ? WHERE id = ?`,
          [x, y, nextZ, id],
          function (err3) {
            if (err3) {
              console.error(err3);
              return res.status(500).json({ ok: false, error: "DB_ERROR" });
            }
            res.json({ ok: true });
          },
        );
      },
    );
  });
});

// GET /liste - JSON list of post-its (AJAX)
app.get("/liste/:board?", (req, res) => {
  const board = req.params.board || "default";
  db.all(
    `
    SELECT p.*, u.username AS author_name
    FROM postits p
    JOIN users u ON p.author_id = u.id
    WHERE p.board = ?
    ORDER BY p.z_index ASC, p.created_at ASC
  `,
    [board],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ ok: false, error: "DB_ERROR" });
      }
      res.json({ ok: true, board, postits: rows });
    },
  );
});

// GET /:board - other boards (MUST be last, after all specific routes)
app.get("/:board", (req, res) => {
  const board = req.params.board || "default";
  db.all(
    `
    SELECT p.*, u.username AS author_name
    FROM postits p
    JOIN users u ON p.author_id = u.id
    WHERE p.board = ?
    ORDER BY p.z_index ASC, p.created_at ASC
  `,
    [board],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Erreur serveur");
      }
      res.render("index", { board, postits: rows });
    },
  );
});

// TODO: routes d’administration pour gérer les rôles (can_create, can_edit, can_delete, can_admin)

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
