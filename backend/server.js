// ------------------------ IMPORT LIBRERIE ------------------------
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./db');

// ------------------------ CONFIGURAZIONE SERVER ------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------ SMTP CONFIG ------------------------
const transporter = nodemailer.createTransport({
  service: 'SendGrid',
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY
  }
});

// ------------------------ UPLOAD ------------------------
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// ------------------------ SESSIONE ------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: true
}));

// ------------------------ STATIC ------------------------
app.use('/cliente', express.static(path.join(__dirname, '../frontend-cliente')));
app.use('/impianto', express.static(path.join(__dirname, '../frontend-impianto')));

// ------------------------ TEST ------------------------
app.get('/', (req, res) => {
  res.send('✅ Server attivo');
});

// ------------------------ CLIENTE: REGISTRAZIONE ------------------------
app.post('/cliente/register', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.send('Compila tutti i campi');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.send('Email non valida');

  try {
    const exists = await db.query('SELECT id FROM utenti WHERE username = $1', [username]);
    if (exists.rows.length > 0) return res.send('Username già registrato');

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO utenti (username, password, email, ruolo) VALUES ($1, $2, $3, $4)',
      [username, hash, email, 'cliente']
    );
    res.redirect('/cliente/dashboard.html');
  } catch (err) {
    console.error('❌ Errore registrazione:', err.message);
    res.send('Errore nella registrazione');
  }
});

// ------------------------ CLIENTE: LOGIN ------------------------
app.post('/cliente/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.send('Compila tutti i campi');

  try {
    const result = await db.query(
      'SELECT * FROM utenti WHERE username = $1 AND ruolo = $2',
      [username, 'cliente']
    );
    const user = result.rows[0];
    if (!user) return res.send('Utente non trovato');
    if (user.bloccato) return res.send('Account bloccato');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.send('Password errata');

    req.session.utente = { id: user.id, username: user.username, ruolo: user.ruolo };
    res.redirect('/cliente/dashboard.html');
  } catch (err) {
    console.error('❌ Login cliente:', err.message);
    res.send('Errore durante il login');
  }
});

// ------------------------ CLIENTE: LOGOUT ------------------------
app.get('/cliente/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/cliente/login.html'));
});

// ------------------------ CLIENTE: PRENOTAZIONI ------------------------
app.get('/cliente/prenotazioni', async (req, res) => {
  if (!req.session.utente) return res.status(403).send([]);
  try {
    const result = await db.query(
      'SELECT * FROM prenotazioni WHERE cliente_id = $1',
      [req.session.utente.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Errore caricamento prenotazioni:', err.message);
    res.send([]);
  }
});

app.post('/cliente/prenotazione', upload.single('certificato_analitico'), async (req, res) => {
  if (!req.session.utente) return res.status(403).send('Devi essere loggato');
  const {
    ragione_sociale, produttore, codice_cer, caratteristiche_pericolo,
    tipo_imballo, tipo_imballo_altro, stato_fisico,
    quantita, giorno_conferimento
  } = req.body;

  const caratteristiche = Array.isArray(caratteristiche_pericolo)
    ? caratteristiche_pericolo.join(',')
    : caratteristiche_pericolo || '';

  const imballo_finale = tipo_imballo === 'Altro' && tipo_imballo_altro
    ? tipo_imballo_altro
    : tipo_imballo;

  const certificato = req.file ? req.file.filename : null;

  try {
    await db.query(`
      INSERT INTO prenotazioni 
      (cliente_id, ragione_sociale, produttore, codice_cer, caratteristiche_pericolo,
      tipo_imballo, stato_fisico, certificato_analitico, quantita, giorno_conferimento)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      req.session.utente.id, ragione_sociale, produttore, codice_cer,
      caratteristiche, imballo_finale, stato_fisico,
      certificato, quantita, giorno_conferimento
    ]);
    res.send('Prenotazione inserita correttamente ✅');
  } catch (err) {
    console.error('❌ Errore inserimento:', err.message);
    res.send('Errore durante l\'inserimento');
  }
});
