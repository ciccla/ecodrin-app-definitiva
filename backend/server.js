// ------------------------ IMPORT LIBRERIE ------------------------
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
// 🔧 Crea la cartella "uploads" se non esiste
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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
app.use('/public', express.static(path.join(__dirname, 'public')));

// ------------------------ TEST ------------------------
app.get('/', (req, res) => {
  res.redirect('/cliente/login.html');
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
// ------------------------ CLIENTE: INFO ACCOUNT ------------------------
app.get('/cliente/info', (req, res) => {
  if (!req.session.utente) return res.status(401).json({ error: 'Non autenticato' });
  res.json({ username: req.session.utente.username });
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
// ------------------------ CLIENTE: RICHIESTE TRASPORTO ------------------------
app.post('/cliente/richieste-trasporto', async (req, res) => {
  if (!req.session.utente) return res.status(403).send('Accesso negato');

  const {
    richiedente, produttore, codice_cer, tipo_automezzo,
    tipo_trasporto, // <-- aggiunto
    data_trasporto, orario_preferito, numero_referente, prezzo_pattuito
  } = req.body;

  try {
    await db.query(`
      INSERT INTO richieste_trasporto 
        (cliente_id, richiedente, produttore, codice_cer, tipo_automezzo, tipo_trasporto,
         data_trasporto, orario_preferito, numero_referente, prezzo_pattuito)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      req.session.utente.id, richiedente, produttore, codice_cer, tipo_automezzo, tipo_trasporto,
      data_trasporto, orario_preferito, numero_referente, prezzo_pattuito
    ]);
    
    res.send('Richiesta trasporto inviata ✅');
  } catch (err) {
    console.error('❌ Errore richiesta trasporto:', err.message);
    res.status(500).send('Errore richiesta trasporto');
  }
});

app.get('/cliente/richieste-trasporto', async (req, res) => {
  if (!req.session.utente) return res.status(403).send('Non autorizzato');
  try {
    const result = await db.query(
      'SELECT * FROM richieste_trasporto WHERE cliente_id = $1 ORDER BY data_trasporto DESC',
      [req.session.utente.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Errore fetch richieste trasporto cliente:', err.message);
    res.status(500).send('Errore server');
  }
});

// ------------------------ ADMIN (IMPIANTO) ------------------------
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

app.get('/impianto/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/impianto/login.html'));
});

app.get('/impianto/prenotazioni', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  try {
    const result = await db.query('SELECT * FROM prenotazioni ORDER BY giorno_conferimento DESC');
    res.json(result.rows);
  } catch (err) {
    res.send('Errore nel recupero');
  }
});

app.get('/impianto/richieste-trasporto', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Non autorizzato');
  try {
    const result = await db.query('SELECT * FROM richieste_trasporto ORDER BY data_trasporto DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Errore nel recupero richieste trasporto:', err.message);
    res.status(500).send('Errore server');
  }
});

app.post('/impianto/cambia-stato', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  const { id, nuovo_stato, richiesta } = req.body;

  try {
    await db.query('UPDATE prenotazioni SET stato = $1 WHERE id = $2', [nuovo_stato, id]);

    const { rows } = await db.query(`
      SELECT u.email, p.produttore, p.giorno_conferimento FROM prenotazioni p
      JOIN utenti u ON p.cliente_id = u.id WHERE p.id = $1
    `, [id]);

    if (rows.length > 0) {
      const email = rows[0].email;
      const testo = `
Gentile cliente,

La tua prenotazione n°${id} del ${rows[0].giorno_conferimento} è stata aggiornata a: ${nuovo_stato.toUpperCase()}
${richiesta ? `\nRichiesta dell’impianto:\n${richiesta}` : ''}

Cordiali saluti,
Impianto`;

      await transporter.sendMail({
        from: `"Ecodrin" <${process.env.EMAIL_USER}>`,
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

app.post('/impianto/aggiorna-trasporto', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  const { id, nuovo_stato, nota } = req.body;

  try {
    await db.query(
      'UPDATE richieste_trasporto SET stato = $1, nota = $2 WHERE id = $3',
      [nuovo_stato, nota, id]
    );

    // Usa la logica della prenotazione per invio email
    const { rows } = await db.query(`
      SELECT u.email, r.data_trasporto 
      FROM richieste_trasporto r
      JOIN utenti u ON r.cliente_id = u.id 
      WHERE r.id = $1
    `, [id]);

    if (rows.length > 0) {
      const email = rows[0].email;
      const dataTrasporto = rows[0].data_trasporto;

      const testo = `
Gentile cliente,

La tua richiesta di trasporto n°${id} del ${dataTrasporto} è stata aggiornata a: ${nuovo_stato.toUpperCase()}
${nota ? `\nNota dell’impianto:\n${nota}` : ''}

Cordiali saluti,
Impianto`;

      await transporter.sendMail({
        from: `"Ecodrin" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Richiesta Trasporto #${id} aggiornata`,
        text: testo
      });

      console.log(`📧 Email trasporto inviata a: ${email}`);
    }

    res.send('Stato trasporto aggiornato e email inviata ✅');
  } catch (err) {
    console.error('❌ Errore aggiornamento trasporto:', err.message);
    res.status(500).send('Errore aggiornamento');
  }
});



// ------------------------ CHAT PRENOTAZIONI ------------------------
app.get('/chat/prenotazione/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM messaggi WHERE prenotazione_id = $1 ORDER BY timestamp ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Errore messaggi prenotazione:', err.message);
    res.status(500).send('Errore');
  }
});

app.post('/chat/prenotazione', async (req, res) => {
  const { prenotazione_id, mittente, messaggio } = req.body;
  if (!prenotazione_id || !mittente || !messaggio) return res.status(400).send('Dati mancanti');

  try {
    await db.query(
      'INSERT INTO messaggi (prenotazione_id, mittente, messaggio) VALUES ($1, $2, $3)',
      [prenotazione_id, mittente, messaggio]
    );
    res.send('Messaggio inviato ✅');
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

// ------------------------ CHAT TRASPORTI ------------------------
app.get('/chat/trasporto/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM messaggi_trasporto WHERE trasporto_id = $1 ORDER BY timestamp ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send('Errore');
  }
});

app.post('/chat/trasporto', async (req, res) => {
  const { trasporto_id, mittente, messaggio } = req.body;
  if (!trasporto_id || !mittente || !messaggio) return res.status(400).send('Dati mancanti');

  try {
    await db.query(
      'INSERT INTO messaggi_trasporto (trasporto_id, mittente, messaggio) VALUES ($1, $2, $3)',
      [trasporto_id, mittente, messaggio]
    );
    res.send('Messaggio inviato ✅');
  } catch (err) {
    res.status(500).send('Errore');
  }
});

// ------------------------ GESTIONE UTENTI ADMIN ------------------------
app.get('/check-utenti', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  try {
    const { rows } = await db.query('SELECT id, username, email, ruolo, bloccato FROM utenti');
    res.json(rows);
  } catch {
    res.status(500).send('Errore nel recupero utenti');
  }
});

app.post('/admin/blocco-utente', async (req, res) => {
  const { id, azione } = req.body;
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  try {
    await db.query('UPDATE utenti SET bloccato = $1 WHERE id = $2', [azione === 'blocca', id]);
    res.send('Utente aggiornato');
  } catch {
    res.status(500).send('Errore aggiornamento');
  }
});

app.post('/admin/elimina-utente', async (req, res) => {
  const { id } = req.body;
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  try {
    await db.query('DELETE FROM utenti WHERE id = $1', [id]);
    res.send('Utente eliminato');
  } catch {
    res.status(500).send('Errore eliminazione');
  }
});
// ------------------------ STATISTICHE ------------------------
app.get('/stats/prenotazioni-giorno', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT giorno_conferimento AS giorno, COUNT(*) AS totale
      FROM prenotazioni
      GROUP BY giorno_conferimento
      ORDER BY giorno_conferimento
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Errore /stats/prenotazioni-giorno:', err.message);
    res.status(500).send('Errore');
  }
});

app.get('/stats/stato-prenotazioni', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT COALESCE(stato, 'in attesa') AS stato, COUNT(*) AS totale
      FROM prenotazioni
      GROUP BY COALESCE(stato, 'in attesa')
    `);
    const output = {};
    rows.forEach(r => output[r.stato] = parseInt(r.totale));
    res.json(output);
  } catch (err) {
    console.error('❌ Errore /stats/stato-prenotazioni:', err.message);
    res.status(500).send('Errore');
  }
});

app.get('/stats/automezzi', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT tipo_automezzo, COUNT(*) AS totale
      FROM richieste_trasporto
      GROUP BY tipo_automezzo
    `);
    const output = {};
    rows.forEach(r => output[r.tipo_automezzo] = parseInt(r.totale));
    res.json(output);
  } catch (err) {
    console.error('❌ Errore /stats/automezzi:', err.message);
    res.status(500).send('Errore');
  }
});

app.get('/stats/utenti-ruolo', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ruolo, COUNT(*) AS totale
      FROM utenti
      GROUP BY ruolo
    `);
    const output = {};
    rows.forEach(r => output[r.ruolo] = parseInt(r.totale));
    res.json(output);
  } catch (err) {
    console.error('❌ Errore /stats/utenti-ruolo:', err.message);
    res.status(500).send('Errore');
  }
});
// ------------------------ STATISTICHE COMPLETE ------------------------
app.get('/stats/dati-completi', async (req, res) => {
  if (!req.session.admin) return res.status(403).send('Accesso negato');
  try {
    const utenti = await db.query('SELECT ruolo FROM utenti');
    const prenotazioni = await db.query('SELECT stato, giorno_conferimento FROM prenotazioni');
    const trasporti = await db.query('SELECT tipo_automezzo FROM richieste_trasporto');

    res.json({
      utenti: utenti.rows,
      prenotazioni: prenotazioni.rows,
      trasporti: trasporti.rows
    });
  } catch (err) {
    console.error('❌ Errore /stats/dati-completi:', err.message);
    res.status(500).send('Errore nel caricamento statistiche');
  }
});
// ------------------------ DOWNLOAD CERTIFICATO PER ADMIN ------------------------
app.get('/impianto/download-certificato/:filename', (req, res) => {
  if (!req.session.admin) return res.status(403).send('Non autorizzato');

  const filePath = path.join(__dirname, 'uploads', req.params.filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File non trovato');
  }
});
// ------------------------ DOWNLOAD CERTIFICATO PER CLIENTE ------------------------
app.get('/cliente/download-certificato/:filename', (req, res) => {
  if (!req.session.utente) return res.status(403).send('Non autorizzato');

  const filePath = path.join(__dirname, 'uploads', req.params.filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File non trovato');
  }
});

// ------------------------ AVVIO SERVER ------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server avviato in ambiente: ${process.env.NODE_ENV || 'sviluppo'}`);
  console.log(`🌐 In ascolto sulla porta: ${PORT}`);
});
