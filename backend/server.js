// ------------------------ IMPORT LIBRERIE ------------------------
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./db');

// ------------------------ CONFIGURAZIONE SERVER ------------------------
const app = express();
const PORT = 3000;
// ✅ Middleware per parsing del body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ------------------------ CONFIGURAZIONE SMTP ------------------------
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
// ------------------------ UPLOAD CONFIG ------------------------
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// ------------------------ MIDDLEWARE ------------------------
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// ------------------------ CREAZIONE TABELLE ------------------------
db.run(`CREATE TABLE IF NOT EXISTS note_richiesta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prenotazione_id INTEGER NOT NULL,
    richiesta TEXT,
    risposta TEXT,
    FOREIGN KEY (prenotazione_id) REFERENCES prenotazioni(id)
)`);

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

// ------------------------ STATIC FILES ------------------------
app.use('/cliente', express.static(path.join(__dirname, '../frontend-cliente')));
app.use('/impianto', express.static(path.join(__dirname, '../frontend-impianto')));

// ------------------------ ROTTE ------------------------

// ✔️ Test server
app.get('/', (req, res) => {
    res.send('Server funzionante ✅');
});

// ------------------------ CLIENTE ------------------------

app.post('/cliente/register', async (req, res) => {
    const { email, username, password } = req.body;
    if (!email || !username || !password) return res.send('Compila tutti i campi!');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.send('Inserisci un\'email valida.');

    db.get('SELECT * FROM utenti WHERE username = ?', [username], async (err, row) => {
        if (err) return res.send('Errore interno.');
        if (row) return res.send('Username già registrato.');

        const hash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO utenti (username, password, email, ruolo) VALUES (?, ?, ?, ?)',
            [username, hash, email, 'cliente'],
            (err) => {
                if (err) return res.send('Errore nella registrazione.');
                res.redirect('/cliente/dashboard.html');
            });
    });
});

// Login cliente
app.post('/cliente/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send('Compila tutti i campi!');

    db.get('SELECT * FROM utenti WHERE username = ? AND ruolo = "cliente"', [username], async (err, user) => {
        if (err) return res.send('Errore interno.');
        if (!user) return res.send('Utente non trovato.');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.send('Password errata.');

        req.session.utente = { id: user.id, username: user.username, ruolo: user.ruolo };
        res.redirect('/cliente/dashboard.html');
    });
});

// Logout cliente
app.get('/cliente/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/cliente/login.html');
    });
});

// Visualizza prenotazioni cliente
app.get('/cliente/prenotazioni', (req, res) => {
    if (!req.session.utente) return res.status(403).send([]);
    db.all('SELECT * FROM prenotazioni WHERE cliente_id = ?', [req.session.utente.id], (err, rows) => {
        if (err) return res.send([]);
        res.json(rows);
    });
});

// Inserisci prenotazione cliente
app.post('/cliente/prenotazione', upload.single('certificato_analitico'), (req, res) => {
    if (!req.session.utente) return res.status(403).send('Devi essere loggato');

    const {
        ragione_sociale, produttore, codice_cer, quantita,
        giorno_conferimento, stato_fisico, tipo_imballo, tipo_imballo_altro
    } = req.body;

    let caratteristiche_pericolo = req.body.caratteristiche_pericolo || [];
    if (!Array.isArray(caratteristiche_pericolo)) {
        caratteristiche_pericolo = [caratteristiche_pericolo];
    }
    caratteristiche_pericolo = caratteristiche_pericolo.join(',');

    const imballo_finale = (tipo_imballo === 'Altro' && tipo_imballo_altro) ? tipo_imballo_altro : tipo_imballo;

    if (!ragione_sociale || !produttore || !codice_cer || !stato_fisico || !imballo_finale || !quantita || !giorno_conferimento) {
        return res.send('Compila tutti i campi obbligatori');
    }

    const certificato = req.file ? req.file.filename : null;

    db.run(`INSERT INTO prenotazioni 
        (cliente_id, ragione_sociale, produttore, codice_cer, caratteristiche_pericolo, tipo_imballo, stato_fisico, certificato_analitico, quantita, giorno_conferimento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.session.utente.id, ragione_sociale, produttore, codice_cer, caratteristiche_pericolo, imballo_finale, stato_fisico, certificato, quantita, giorno_conferimento],
        (err) => {
            if (err) {
                console.error('❌ Errore durante l\'inserimento prenotazione:', err.message);
                return res.send('Errore durante l\'inserimento.');
            }
            res.send('Prenotazione inserita correttamente ✅');
        }
    );
});
// ✅ Cliente invia risposta all'impianto
app.post('/cliente/invia-risposta', (req, res) => {
    if (!req.session.utente) return res.status(403).send('Accesso negato');

    const { prenotazione_id, risposta } = req.body;

    if (!risposta || !prenotazione_id) return res.send('Devi inserire una risposta valida.');

    db.run(
        'UPDATE note_richiesta SET risposta = ? WHERE prenotazione_id = ?',
        [risposta, prenotazione_id],
        (err) => {
            if (err) {
                console.error('❌ Errore salvataggio risposta:', err.message);
                return res.send('Errore durante l\'invio della risposta.');
            }
            res.send('Risposta inviata ✅');
        }
    );
});
// richiesta di trasporto dal cliente loggato
app.post('/cliente/richieste-trasporto', (req, res) => {
    if (!req.session.utente) return res.status(403).send('Accesso negato');

    const {
        richiedente, produttore, codice_cer, tipo_automezzo,
        data_trasporto, orario_preferito, numero_referente, prezzo_pattuito
    } = req.body;

    if (!richiedente || !produttore || !codice_cer || !tipo_automezzo || !data_trasporto || !orario_preferito || !numero_referente || !prezzo_pattuito) {
        return res.send('Compila tutti i campi obbligatori.');
    }

    db.run(`INSERT INTO richieste_trasporto 
        (cliente_id, richiedente, produttore, codice_cer, tipo_automezzo, data_trasporto, orario_preferito, numero_referente, prezzo_pattuito)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.session.utente.id, richiedente, produttore, codice_cer, tipo_automezzo, data_trasporto, orario_preferito, numero_referente, prezzo_pattuito],
        (err) => {
            if (err) {
                console.error('Errore nel salvataggio della richiesta:', err.message);
                return res.send('Errore nel salvataggio della richiesta.');
            }
            res.send('Richiesta trasporto inviata correttamente ✅');
        }
    );
});
// ------------------------ IMPIANTO ------------------------

app.post('/impianto/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.send('Compila tutti i campi!');

    db.get('SELECT * FROM utenti WHERE username = ? AND ruolo = "admin"', [username], async (err, user) => {
        if (err) return res.send('Errore interno.');
        if (!user) return res.send('Admin non trovato.');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.send('Password errata.');

        req.session.admin = { id: user.id, username: user.username, ruolo: user.ruolo };
        res.send('Login impianto effettuato con successo ✅');
    });
});

// Logout impianto
app.get('/impianto/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/impianto/login.html');
    });
});

// Visualizza tutte le prenotazioni
app.get('/impianto/prenotazioni', (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');

    db.all('SELECT * FROM prenotazioni', (err, rows) => {
        if (err) return res.send('Errore nella lettura delle prenotazioni.');
        res.json(rows);
    });
});
// Visualizza tutte le richieste di trasporto
app.get('/impianto/richieste-trasporto', (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');

    db.all('SELECT * FROM richieste_trasporto ORDER BY data_trasporto DESC', (err, rows) => {
        if (err) return res.send('Errore nel recupero delle richieste.');
        res.json(rows);
    });
});
app.post('/impianto/aggiorna-trasporto', (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');

    const { id, nuovo_stato, nota } = req.body;

    const stati_validi = ['accettata', 'non accettata', 'info richieste'];
    if (!stati_validi.includes(nuovo_stato)) return res.send('Stato non valido');

    db.run('UPDATE richieste_trasporto SET stato = ?, nota = ? WHERE id = ?', [nuovo_stato, nota, id], (err) => {
        if (err) return res.send('Errore durante l\'aggiornamento');

        // Invia email al cliente
        db.get(`
            SELECT r.*, u.email 
            FROM richieste_trasporto r 
            JOIN utenti u ON u.id = r.cliente_id 
            WHERE r.id = ?
        `, [id], (err, row) => {
            if (err || !row) return res.send('Aggiornato ma impossibile inviare email');

            const testoMail = `
Gentile cliente,

la richiesta di trasporto n°${row.id} per il produttore: ${row.produttore} è stata aggiornata a:

👉 STATO: ${nuovo_stato.toUpperCase()}

${nota ? `✏️ Annotazione impianto:\n${nota}` : ''}

Cordiali saluti,
Impianto
            `;

            transporter.sendMail({
                from: '"Impianto ecodrin" <diegotrinchillo@gmail.com>',
                to: row.email,
                subject: `Aggiornamento richiesta trasporto #${row.id}`,
                text: testoMail
            }, (error, info) => {
                if (error) {
                    console.error('Errore invio email:', error);
                } else {
                    console.log('📧 Email inviata a', row.email);
                }
            });

            res.send('Stato trasporto aggiornato con successo ✅');
        });
    });
});
// Cambia stato prenotazione + invia email al cliente
app.post('/impianto/cambia-stato', (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');

    const { id, nuovo_stato, richiesta } = req.body;

    const stati_validi = ['accettata', 'non accettata', 'info richieste'];
    if (!stati_validi.includes(nuovo_stato)) return res.send('Stato non valido.');

    db.run('UPDATE prenotazioni SET stato = ? WHERE id = ?', [nuovo_stato, id], (err) => {
        if (err) return res.send('Errore durante l\'aggiornamento.');

        // Invio mail
        db.get(`SELECT u.email, p.produttore FROM prenotazioni p JOIN utenti u ON u.id = p.cliente_id WHERE p.id = ?`, [id], (err, cliente) => {
            if (!err && cliente) {
                transporter.sendMail({
                    from: '"Impianto" <diegotrinchillo@gmail.com>',
                    to: cliente.email,
                    subject: `Aggiornamento prenotazione #${id} - ${cliente.produttore}`,
                    text: `Gentile cliente, la informiamo che la tua prenotazione n°${id} relativa al produttore: ${cliente.produttore}, è stata aggiornata a: ${nuovo_stato.toUpperCase()}${nuovo_stato === 'info richieste' ? `\n\nRichiesta dell'impianto:\n${richiesta}` : ''}`
                }, (error, info) => {
                    if (error) {
                        console.error('Errore invio email:', error);
                    } else {
                        console.log('✅ Email inviata correttamente a', cliente.email);
                        console.log('Message ID:', info.messageId);
                    }
                });
            }
        });

        // Se info richieste ➤ salva nota
        if (nuovo_stato === 'info richieste') {
            if (!richiesta) return res.send('Devi inserire una richiesta.');
            db.run('INSERT INTO note_richiesta (prenotazione_id, richiesta) VALUES (?, ?)', [id, richiesta], (err) => {
                if (err) return res.send('Errore nel salvataggio della richiesta.');
                res.send('Stato e richiesta aggiornati ✅');
            });
        } else {
            res.send('Stato aggiornato ✅');
        }
    });
});

// Leggi richiesta e risposta
app.get('/impianto/note/:prenotazione_id', (req, res) => {
    if (!req.session.admin && !req.session.utente) return res.status(403).send('Accesso negato');
    const prenotazione_id = req.params.prenotazione_id;
    db.get('SELECT * FROM note_richiesta WHERE prenotazione_id = ?', [prenotazione_id], (err, row) => {
        if (err) return res.send({});
        res.json(row || {});
    });
});

// ------------------------ DOWNLOAD CERTIFICATO ------------------------
app.get('/impianto/download-certificato/:filename', (req, res) => {
    if (!req.session.admin) return res.status(403).send('Accesso negato');
    const file = path.join(__dirname, 'uploads', req.params.filename);
    if (!fs.existsSync(file)) {
        return res.status(404).send('Certificato non trovato.');
    }
    res.download(file);
});

// ------------------------ AVVIO SERVER ------------------------
app.listen(PORT, () => {
    console.log(`Server avviato su http://localhost:${PORT}`);
});