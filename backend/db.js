// db.js - versione PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

console.log("📦 Connessione al database PostgreSQL in corso...");
console.log(`🔗 Host: ${process.env.PG_HOST}`);
console.log(`🗄️ Database: ${process.env.PG_DATABASE}`);
console.log(`👤 Utente: ${process.env.PG_USER}`);

// ✅ Crea le tabelle solo la prima volta (utile in dev)
const creaTabelle = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS utenti (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT,
        ruolo TEXT CHECK(ruolo IN ('cliente', 'admin')) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prenotazioni (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES utenti(id),
        ragione_sociale TEXT,
        produttore TEXT,
        codice_cer TEXT,
        caratteristiche_pericolo TEXT,
        tipo_imballo TEXT,
        stato_fisico TEXT,
        certificato_analitico TEXT,
        quantita REAL,
        giorno_conferimento TEXT,
        stato TEXT DEFAULT 'in attesa'
      );

      CREATE TABLE IF NOT EXISTS messaggi (
        id SERIAL PRIMARY KEY,
        prenotazione_id INTEGER REFERENCES prenotazioni(id),
        mittente TEXT,
        messaggio TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS richieste_trasporto (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES utenti(id),
        richiedente TEXT NOT NULL,
        produttore TEXT NOT NULL,
        codice_cer TEXT NOT NULL,
        tipo_automezzo TEXT NOT NULL,
        data_trasporto TEXT NOT NULL,
        orario_preferito TEXT NOT NULL,
        numero_referente TEXT NOT NULL,
        prezzo_pattuito REAL NOT NULL,
        stato TEXT DEFAULT 'in attesa',
        nota TEXT
      );
    `);
    console.log("✅ Tabelle PostgreSQL create correttamente");
  } catch (err) {
    console.error("❌ Errore nella creazione delle tabelle:");
    console.error(err.stack);
  }
};

// 👤 Admin default
const creaAdminDefault = async () => {
  try {
    const result = await pool.query("SELECT * FROM utenti WHERE email = 'admin@example.com'");
    if (result.rows.length === 0) {
      const bcrypt = require('bcrypt');
      const password = await bcrypt.hash('admin123', 10);
      await pool.query(`
        INSERT INTO utenti (username, password, email, ruolo)
        VALUES ($1, $2, $3, $4)
      `, ['admin', password, 'admin@example.com', 'admin']);
      console.log("✅ Admin creato automaticamente");
    } else {
      console.log("ℹ️ Admin già presente nel database");
    }
  } catch (err) {
    console.error("❌ Errore creazione admin:");
    console.error(err.stack);
  }
};

// Avvio creazione tabelle e admin
creaTabelle();
creaAdminDefault();

// ✅ Funzione di query esportata
module.exports = {
  query: (text, params) => pool.query(text, params)
};
