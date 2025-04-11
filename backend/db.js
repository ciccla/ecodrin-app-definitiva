const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Percorso del database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Creazione tabelle
db.serialize(() => {
    // Tabella utenti
    db.run(`CREATE TABLE IF NOT EXISTS utenti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT,
        ruolo TEXT CHECK(ruolo IN ('cliente', 'admin')) NOT NULL
    )`);

    // Tabella prenotazioni
    db.run(`CREATE TABLE IF NOT EXISTS prenotazioni (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER,
        ragione_sociale TEXT,
        produttore TEXT,
        codice_cer TEXT,
        caratteristiche_pericolo TEXT,
        tipo_imballo TEXT,
        stato_fisico TEXT,
        certificato_analitico TEXT,
        quantita REAL,
        giorno_conferimento TEXT,
        stato TEXT DEFAULT 'in attesa',
        FOREIGN KEY(cliente_id) REFERENCES utenti(id)
    )`);

    // Tabella messaggi
    db.run(`CREATE TABLE IF NOT EXISTS messaggi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prenotazione_id INTEGER,
        mittente TEXT,
        messaggio TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(prenotazione_id) REFERENCES prenotazioni(id)
    )`);

    // Tabella richieste trasporto
    db.run(`CREATE TABLE IF NOT EXISTS richieste_trasporto (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        richiedente TEXT NOT NULL,
        produttore TEXT NOT NULL,
        codice_cer TEXT NOT NULL,
        tipo_automezzo TEXT NOT NULL,
        data_trasporto TEXT NOT NULL,
        orario_preferito TEXT NOT NULL,
        numero_referente TEXT NOT NULL,
        prezzo_pattuito REAL NOT NULL,
        stato TEXT DEFAULT 'in attesa',
        nota TEXT,
        FOREIGN KEY (cliente_id) REFERENCES utenti(id)
    )`);

    console.log("✅ Database e tabelle creati");
});
// Inserisce un admin di default se non esiste
db.get("SELECT * FROM utenti WHERE email = 'admin@example.com'", async (err, row) => {
    if (err) return console.error("Errore nella verifica admin:", err.message);
    if (!row) {
        const bcrypt = require('bcrypt');
        const password = await bcrypt.hash('admin123', 10);
        db.run(`INSERT INTO utenti (username, password, email, ruolo) VALUES (?, ?, ?, ?)`,
            ['admin', password, 'admin@example.com', 'admin'],
            (err) => {
                if (err) console.error("❌ Errore inserimento admin:", err.message);
                else console.log("✅ Admin creato automaticamente.");
            });
    } else {
        console.log("ℹ️ Admin già presente nel database.");
    }
});

module.exports = db;