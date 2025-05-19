const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const ip = '100.94.106.86'; // Alamat IP server
const port = process.env.PORT || 3001; // Mengubah port default dari 3000 ke 3001

// Create SQLite database connection
const db = new sqlite3.Database('./jadwal_kuliah.db', (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err);
    return;
  }
  console.log('Connected to SQLite database');
  
  // Create the jadwal table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS jadwal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hari TEXT NOT NULL,
      mata_kuliah TEXT NOT NULL,
      jam_mulai TEXT NOT NULL,
      jam_selesai TEXT NOT NULL,
      ruangan TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating jadwal table:', err);
      return;
    }
    console.log('Jadwal table created or already exists');
  });
  
  // Create the tugas table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS tugas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mata_kuliah TEXT NOT NULL,
      deskripsi TEXT NOT NULL,
      deadline_tanggal DATE NOT NULL,
      deadline_waktu TIME NOT NULL,
      tempat_pengumpulan TEXT,
      is_completed BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating tugas table:', err);
      return;
    }
    console.log('Tugas table created or already exists');
  });
});

// Function to delete expired tasks
function deleteExpiredTasks() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];
  
  const query = `DELETE FROM tugas WHERE (deadline_tanggal < ?) OR (deadline_tanggal = ? AND deadline_waktu <= ?)`;
  
  db.run(query, [dateStr, dateStr, timeStr], function(err) {
    if (err) {
      console.error('Error deleting expired tasks:', err);
    } else if (this.changes > 0) {
      console.log(`Deleted ${this.changes} expired tasks`);
    }
  });
}

// Check for expired tasks every minute
setInterval(deleteExpiredTasks, 60000);

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
// Home page - Show all schedules
app.get('/', (req, res) => {
  const query = 'SELECT * FROM jadwal ORDER BY hari, jam_mulai';
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching schedules:', err);
      return res.status(500).send('Error fetching schedules');
    }
    res.render('index', { jadwal: rows });
  });
});

// Add new schedule form
app.get('/add', (req, res) => {
  res.render('add');
});

// Add new schedule action
app.post('/add', (req, res) => {
  const { hari, mata_kuliah, jam_mulai, jam_selesai, ruangan } = req.body;
  const query = 'INSERT INTO jadwal (hari, mata_kuliah, jam_mulai, jam_selesai, ruangan) VALUES (?, ?, ?, ?, ?)';
  
  db.run(query, [hari, mata_kuliah, jam_mulai, jam_selesai, ruangan], function(err) {
    if (err) {
      console.error('Error adding schedule:', err);
      return res.status(500).send('Error adding schedule');
    }
    res.redirect('/');
  });
});

// Edit schedule form
app.get('/edit/:id', (req, res) => {
  const id = req.params.id;
  const query = 'SELECT * FROM jadwal WHERE id = ?';
  
  db.get(query, [id], (err, row) => {
    if (err) {
      console.error('Error fetching schedule:', err);
      return res.status(500).send('Error fetching schedule');
    }
    
    if (!row) {
      return res.status(404).send('Schedule not found');
    }
    
    res.render('edit', { jadwal: row });
  });
});

// Update schedule action
app.post('/edit/:id', (req, res) => {
  const id = req.params.id;
  const { hari, mata_kuliah, jam_mulai, jam_selesai, ruangan } = req.body;
  const query = 'UPDATE jadwal SET hari = ?, mata_kuliah = ?, jam_mulai = ?, jam_selesai = ?, ruangan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  
  db.run(query, [hari, mata_kuliah, jam_mulai, jam_selesai, ruangan, id], function(err) {
    if (err) {
      console.error('Error updating schedule:', err);
      return res.status(500).send('Error updating schedule');
    }
    res.redirect('/');
  });
});

// Delete schedule
app.get('/delete/:id', (req, res) => {
  const id = req.params.id;
  const query = 'DELETE FROM jadwal WHERE id = ?';
  
  db.run(query, [id], function(err) {
    if (err) {
      console.error('Error deleting schedule:', err);
      return res.status(500).send('Error deleting schedule');
    }
    res.redirect('/');
  });
});

// ======= TUGAS ROUTES ======= //

// List all tasks
app.get('/tugas', (req, res) => {
  const query = 'SELECT * FROM tugas WHERE is_completed = 0 ORDER BY deadline_tanggal, deadline_waktu';
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching tasks:', err);
      return res.status(500).send('Error fetching tasks');
    }
    res.render('tugas/index', { tugas: rows });
  });
});

// Add new task form
app.get('/tugas/add', (req, res) => {
  res.render('tugas/add');
});

// Add new task action
app.post('/tugas/add', (req, res) => {
  const { mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan } = req.body;
  const query = 'INSERT INTO tugas (mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan) VALUES (?, ?, ?, ?, ?)';
  
  db.run(query, [mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan || ''], function(err) {
    if (err) {
      console.error('Error adding task:', err);
      return res.status(500).send('Error adding task');
    }
    res.redirect('/tugas');
  });
});

// Edit task form
app.get('/tugas/edit/:id', (req, res) => {
  const id = req.params.id;
  const query = 'SELECT * FROM tugas WHERE id = ?';
  
  db.get(query, [id], (err, row) => {
    if (err) {
      console.error('Error fetching task:', err);
      return res.status(500).send('Error fetching task');
    }
    
    if (!row) {
      return res.status(404).send('Task not found');
    }
    
    res.render('tugas/edit', { tugas: row });
  });
});

// Update task action
app.post('/tugas/edit/:id', (req, res) => {
  const id = req.params.id;
  const { mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan } = req.body;
  const query = 'UPDATE tugas SET mata_kuliah = ?, deskripsi = ?, deadline_tanggal = ?, deadline_waktu = ?, tempat_pengumpulan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  
  db.run(query, [mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan || '', id], function(err) {
    if (err) {
      console.error('Error updating task:', err);
      return res.status(500).send('Error updating task');
    }
    res.redirect('/tugas');
  });
});

// Delete task
app.get('/tugas/delete/:id', (req, res) => {
  const id = req.params.id;
  const query = 'DELETE FROM tugas WHERE id = ?';
  
  db.run(query, [id], function(err) {
    if (err) {
      console.error('Error deleting task:', err);
      return res.status(500).send('Error deleting task');
    }
    res.redirect('/tugas');
  });
});

// Mark task as completed
app.get('/tugas/complete/:id', (req, res) => {
  const id = req.params.id;
  const query = 'UPDATE tugas SET is_completed = 1 WHERE id = ?';
  
  db.run(query, [id], function(err) {
    if (err) {
      console.error('Error completing task:', err);
      return res.status(500).send('Error completing task');
    }
    res.redirect('/tugas');
  });
});

// Start the server
app.listen(port, ip, () => {
  console.log(`Server running on http://${ip}:${port}`);
}); 