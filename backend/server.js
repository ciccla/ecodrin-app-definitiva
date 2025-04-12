// ------------------------ IMPORT LIBRERIE ------------------------
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./db'); // Usa pool PostgreSQL

// ------------------------ CONFIGURAZIONE SERVER ------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------ CONFIGURAZIONE SMTP ------------------------
const transporter = nodemailer.createTransport({
    host: 'smtp.libero.it',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
// ------------------------ UPLOAD CONFIG ------------------------
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// ------------------------ MIDDLEWARE SESSIONE ------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: true
}));

// ------------------------ STATIC FILES ------------------------
app.use('/cliente', express.static(path.join(__dirname, '../frontend-cliente')));
app.use('/impianto', express.static(path.join(__dirname, '../frontend-impianto')));

// ------------------------ ROUTES ------------------------

// Test server
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

// ------------------------ CLIENTE: PRENOTAZIONI - VISUALIZZA ------------------------
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
// ------------------------ CLIENTE: NUOVA PRENOTAZIONE ------------------------
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
  
  // ------------------------ CLIENTE: INVIA RISPOSTA ------------------------
  app.post('/cliente/invia-risposta', async (req, res) => {
    if (!req.session.utente) return res.status(403).send('Accesso negato');
    const { prenotazione_id, risposta } = req.body;
    if (!risposta || !prenotazione_id) return res.send('Dati mancanti');
  
    try {
      await db.query(
        'UPDATE note_richiesta SET risposta = $1 WHERE prenotazione_id = $2',
        [risposta, prenotazione_id]
      );
      res.send('Risposta inviata ✅');
    } catch (err) {
      console.error(err);
      res.send('Errore nell\'invio risposta');
    }
  });
  
  // ------------------------ CLIENTE: RICHIESTA TRASPORTO ------------------------
  app.post('/cliente/richieste-trasporto', async (req, res) => {
    if (!req.session.utente) return res.status(403).send('Accesso negato');
    const {
      richiedente, produttore, codice_cer, tipo_automezzo,
      data_trasporto, orario_preferito, numero_referente, prezzo_pattuito
    } = req.body;
  
    try {
      await db.query(`
        INSERT INTO richieste_trasporto 
        (cliente_id, richiedente, produttore, codice_cer, tipo_automezzo,
        data_trasporto, orario_preferito, numero_referente, prezzo_pattuito)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        req.session.utente.id, richiedente, produttore, codice_cer, tipo_automezzo,
        data_trasporto, orario_preferito, numero_referente, prezzo_pattuito
      ]);
      res.send('Richiesta trasporto inviata ✅');
    } catch (err) {
      console.error(err);
      res.send('Errore richiesta trasporto');
    }
  });
  
  // ------------------------ IMPIANTO: LOGIN ------------------------
  app.post('/impianto/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send('Compila tutti i campi');
  
    try {
      const result = await db.query('SELECT * FROM utenti WHERE email = $1 AND ruolo = $2', [username, 'admin']);
      const user = result.rows[0];
      if (!user) return res.send('Admin non trovato');
  
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.send('Password errata');
  
      req.session.admin = { id: user.id, username: user.username, ruolo: user.ruolo };
      res.send('Login impianto effettuato con successo ✅');
    } catch (err) {
      console.error(err);
      res.send('Errore login impianto');
    }
  });
  
  // ------------------------ IMPIANTO: LOGOUT ------------------------
  app.get('/impianto/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/impianto/login.html'));
  });
  
  // ------------------------ IMPIANTO: PRENOTAZIONI ------------------------
  app.get('/impianto/prenotazioni', async (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');
    try {
      const result = await db.query('SELECT * FROM prenotazioni ORDER BY giorno_conferimento DESC');
      res.json(result.rows);
    } catch (err) {
      res.send('Errore nel recupero');
    }
  });
  
  // ------------------------ IMPIANTO: CAMBIA STATO + EMAIL ------------------------
  app.post('/impianto/cambia-stato', async (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');
    const { id, nuovo_stato, richiesta } = req.body;
  
    try {
      await db.query('UPDATE prenotazioni SET stato = $1 WHERE id = $2', [nuovo_stato, id]);
  
      if (nuovo_stato === 'info richieste') {
        await db.query('INSERT INTO note_richiesta (prenotazione_id, richiesta) VALUES ($1, $2)', [id, richiesta]);
      }
  
      // Email al cliente
      const { rows } = await db.query(`
        SELECT u.email, p.produttore FROM prenotazioni p
        JOIN utenti u ON p.cliente_id = u.id WHERE p.id = $1
      `, [id]);
  
      if (rows.length > 0) {
        const email = rows[0].email;
        const testo = `
  Gentile cliente,
  
  La tua prenotazione n°${id} è stata aggiornata a: ${nuovo_stato.toUpperCase()}
  ${richiesta ? `\nRichiesta dell’impianto:\n${richiesta}` : ''}
  
  Cordiali saluti,
  Impianto`;
  
        await transporter.sendMail({
          from: '"Ecodrin" <noreply@ecodrin.com>',
          to: email,
          subject: `Prenotazione #${id} aggiornata`,
          text: testo
        });
      }
  
      res.send('Stato aggiornato ✅');
    } catch (err) {
      console.error(err);
      res.send('Errore aggiornamento');
    }
  });
  
  // ------------------------ NOTE PRENOTAZIONE ------------------------
  app.get('/impianto/note/:prenotazione_id', async (req, res) => {
    const id = req.params.prenotazione_id;
    try {
      const result = await db.query('SELECT * FROM note_richiesta WHERE prenotazione_id = $1', [id]);
      res.json(result.rows[0] || {});
    } catch (err) {
      res.send({});
    }
  });
  
  // ------------------------ CHECK UTENTI ------------------------
  app.get('/check-utenti', async (req, res) => {
    try {
      const { rows } = await db.query('SELECT * FROM utenti');
      res.json(rows);
    } catch {
      res.status(500).send('Errore nel recupero utenti');
    }
  });
  
  // ------------------------ AVVIO SERVER ------------------------
  app.listen(PORT, () => {
    console.log(`🚀 Server avviato su http://localhost:${PORT}`);
  });
  