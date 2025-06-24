const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');  // Tambahkan ini untuk menjalankan perintah shell
require('dotenv').config();
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const ip = 'localhost'; // Alamat IP server
const port = process.env.PORT || 3002; // Mengubah port default dari 3000 ke 3002

// Middleware untuk autentikasi PIN
const authenticatePin = (req, res, next) => {
  const pin = req.body.pin || req.query.pin;
  
  if (pin === '2222') {
    next();
  } else {
    res.status(401).render('bot-status', { 
      isRunning: null,
      error: 'PIN tidak valid. Silakan masukkan PIN yang benar.',
      showPinForm: true
    });
  }
};

// Create SQLite database connection with absolute path
const dbPath = path.join(__dirname, 'jadwal_kuliah.db');
console.log('Using database at:', dbPath); // Log untuk memverifikasi path database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err);
    return;
  }
  console.log('Connected to SQLite database');
  
  // Add user_number column to jadwal table if it doesn't exist
  db.run(`ALTER TABLE jadwal ADD COLUMN user_number TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding user_number column to jadwal:', err);
    }
  });

  // Add user_number column to tugas table if it doesn't exist
  db.run(`ALTER TABLE tugas ADD COLUMN user_number TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding user_number column to tugas:', err);
    }
  });
  
  // Create the jadwal table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS jadwal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hari TEXT NOT NULL,
      mata_kuliah TEXT NOT NULL,
      jam_mulai TEXT NOT NULL,
      jam_selesai TEXT NOT NULL,
      ruangan TEXT NOT NULL,
      user_number TEXT,
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
      user_number TEXT,
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

// Rate limiter untuk mencegah brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10, // maksimal 10 percobaan (dinaikan karena kode lebih pendek)
  message: {
    error: 'Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Session middleware dengan pengaturan keamanan
app.use(session({
  secret: 'fs-server-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true, // Mencegah akses cookie melalui JavaScript client-side
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // Mencegah CSRF
  }
}));

// Middleware keamanan dasar
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
  // Exclude login route and static assets from authentication
  if (req.path === '/login' || req.path.startsWith('/public/')) {
    return next();
  }

  if (!req.session.authenticated) {
    return res.redirect('/login');
  }
  next();
};

// Apply authentication middleware to all routes
app.use(authenticateUser);

// Login routes dengan validasi dan sanitasi
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login');
});

app.post('/login', 
  loginLimiter,
  [
    body('registration_key')
      .trim()
      .notEmpty().withMessage('Kunci registrasi harus diisi')
      .isLength({ min: 4, max: 4 }).withMessage('Kunci registrasi harus 4 digit')
      .isNumeric().withMessage('Kunci registrasi hanya boleh berisi angka')
      .escape()
  ],
  async (req, res) => {
    try {
      // Cek hasil validasi
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.render('login', { 
          error: errors.array()[0].msg
        });
      }

      const { registration_key } = req.body;

      // Gunakan parameterized query untuk mencegah SQL injection
      const query = 'SELECT * FROM registrations WHERE registration_key = ?';
      
      // Wrap database query dalam Promise untuk better error handling
      const row = await new Promise((resolve, reject) => {
        db.get(query, [registration_key], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!row) {
        return res.render('login', { 
          error: 'Kunci registrasi tidak valid' 
        });
      }

      // Set session data
      req.session.authenticated = true;
      req.session.user_number = row.user_number; // Tambahkan user_number ke session
      res.redirect('/');
    } catch (error) {
      console.error('Login error:', error);
      res.render('login', { 
        error: 'Terjadi kesalahan saat login' 
      });
    }
  });

// Logout route dengan penanganan keamanan
app.get('/logout', (req, res) => {
  // Destroy session secara aman
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    // Clear cookie even if session destruction fails
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// Routes
// Home page - Show all schedules
app.get('/', (req, res) => {
  // Get jadwal
  db.all('SELECT * FROM jadwal ORDER BY CASE hari ' +
    "WHEN 'Senin' THEN 1 " +
    "WHEN 'Selasa' THEN 2 " +
    "WHEN 'Rabu' THEN 3 " +
    "WHEN 'Kamis' THEN 4 " +
    "WHEN 'Jumat' THEN 5 " +
    "WHEN 'Sabtu' THEN 6 " +
    "WHEN 'Minggu' THEN 7 " +
    'END, jam_mulai', (err, jadwal) => {
    if (err) {
      console.error('Error fetching jadwal:', err);
      return res.status(500).send('Terjadi kesalahan saat mengambil data jadwal');
    }

    // Get last 5 updates from jadwal and tugas
    const lastUpdatesQuery = `
      SELECT 
        'jadwal' as tipe,
        id,
        mata_kuliah,
        user_number,
        updated_at,
        'Jadwal' as jenis_perubahan
      FROM jadwal
      UNION ALL
      SELECT 
        'tugas' as tipe,
        id,
        mata_kuliah,
        user_number,
        updated_at,
        CASE 
          WHEN is_completed = 1 THEN 'Tugas Selesai'
          ELSE 'Tugas'
        END as jenis_perubahan
      FROM tugas
      ORDER BY updated_at DESC
      LIMIT 5
    `;

    db.all(lastUpdatesQuery, [], (err, lastUpdates) => {
      if (err) {
        console.error('Error fetching last updates:', err);
        lastUpdates = [];
      }

      // Get user numbers for mapping
      const userNumbers = [...new Set(lastUpdates.map(update => update.user_number))];
      if (userNumbers.length > 0) {
        const placeholders = userNumbers.map(() => '?').join(',');
        const userQuery = `SELECT user_number FROM registrations WHERE user_number IN (${placeholders})`;
        
        db.all(userQuery, userNumbers, (err, users) => {
          if (err) {
            console.error('Error fetching users:', err);
            users = [];
          }

          // Format the last updates
          const formattedUpdates = lastUpdates.map(update => ({
            ...update,
            user_number: update.user_number || 'System',
            updated_at: new Date(update.updated_at).toLocaleString('id-ID', {
              dateStyle: 'medium',
              timeStyle: 'short'
            })
          }));

          res.render('index', { 
            jadwal,
            lastUpdates: formattedUpdates,
            currentUser: req.session.user_number
          });
        });
      } else {
        res.render('index', { 
          jadwal,
          lastUpdates: [],
          currentUser: req.session.user_number
        });
      }
    });
  });
});

// Add new schedule form
app.get('/add', (req, res) => {
  res.render('add');
});

// Add new schedule action
app.post('/add', [
  body('hari')
    .notEmpty().withMessage('Hari harus diisi')
    .isIn(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']).withMessage('Hari tidak valid'),
  body('mata_kuliah')
    .notEmpty().withMessage('Mata kuliah harus diisi'),
  body('jam_mulai')
    .notEmpty().withMessage('Jam mulai harus diisi')
    .isTime().withMessage('Format jam mulai tidak valid'),
  body('jam_selesai')
    .notEmpty().withMessage('Jam selesai harus diisi')
    .isTime().withMessage('Format jam selesai tidak valid'),
  body('ruangan')
    .notEmpty().withMessage('Ruangan harus diisi')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('add', { 
      error: errors.array()[0].msg,
      jadwal: req.body
    });
  }

  const { hari, mata_kuliah, jam_mulai, jam_selesai, ruangan } = req.body;
  const user_number = req.session.user_number;

  const query = `
    INSERT INTO jadwal (hari, mata_kuliah, jam_mulai, jam_selesai, ruangan, user_number, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `;
  
  db.run(query, [hari, mata_kuliah, jam_mulai, jam_selesai, ruangan, user_number], (err) => {
    if (err) {
      console.error('Error adding schedule:', err);
      return res.render('add', {
        error: 'Terjadi kesalahan saat menambahkan jadwal',
        jadwal: req.body
      });
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
app.post('/edit/:id', [
  body('hari')
    .notEmpty().withMessage('Hari harus diisi')
    .isIn(['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']).withMessage('Hari tidak valid'),
  body('mata_kuliah')
    .notEmpty().withMessage('Mata kuliah harus diisi'),
  body('jam_mulai')
    .notEmpty().withMessage('Jam mulai harus diisi')
    .isTime().withMessage('Format jam mulai tidak valid'),
  body('jam_selesai')
    .notEmpty().withMessage('Jam selesai harus diisi')
    .isTime().withMessage('Format jam selesai tidak valid'),
  body('ruangan')
    .notEmpty().withMessage('Ruangan harus diisi')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('edit', {
      error: errors.array()[0].msg,
      jadwal: { ...req.body, id: req.params.id }
    });
  }

  const { hari, mata_kuliah, jam_mulai, jam_selesai, ruangan } = req.body;
  const { id } = req.params;
  const user_number = req.session.user_number;

  const query = `
    UPDATE jadwal 
    SET hari = ?, 
        mata_kuliah = ?, 
        jam_mulai = ?, 
        jam_selesai = ?, 
        ruangan = ?,
        user_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  db.run(query, [hari, mata_kuliah, jam_mulai, jam_selesai, ruangan, user_number, id], (err) => {
    if (err) {
      console.error('Error updating schedule:', err);
      return res.render('edit', {
        error: 'Terjadi kesalahan saat mengupdate jadwal',
        jadwal: { ...req.body, id }
      });
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
app.post('/tugas/add', [
  body('mata_kuliah')
    .notEmpty().withMessage('Mata kuliah harus diisi'),
  body('deskripsi')
    .notEmpty().withMessage('Deskripsi harus diisi'),
  body('deadline_tanggal')
    .notEmpty().withMessage('Deadline tanggal harus diisi')
    .isDate().withMessage('Format deadline tanggal tidak valid'),
  body('deadline_waktu')
    .notEmpty().withMessage('Deadline waktu harus diisi')
    .isTime().withMessage('Format deadline waktu tidak valid'),
  body('tempat_pengumpulan')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('tugas/add', {
      error: errors.array()[0].msg,
      tugas: req.body
    });
  }

  const { mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan } = req.body;
  const user_number = req.session.user_number;

  const query = `
    INSERT INTO tugas (
      mata_kuliah, 
      deskripsi, 
      deadline_tanggal, 
      deadline_waktu, 
      tempat_pengumpulan,
      user_number,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `;

  db.run(query, [
    mata_kuliah, 
    deskripsi, 
    deadline_tanggal, 
    deadline_waktu, 
    tempat_pengumpulan,
    user_number
  ], (err) => {
    if (err) {
      console.error('Error adding task:', err);
      return res.render('tugas/add', {
        error: 'Terjadi kesalahan saat menambahkan tugas',
        tugas: req.body
      });
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
app.post('/tugas/edit/:id', [
  body('mata_kuliah')
    .notEmpty().withMessage('Mata kuliah harus diisi'),
  body('deskripsi')
    .notEmpty().withMessage('Deskripsi harus diisi'),
  body('deadline_tanggal')
    .notEmpty().withMessage('Deadline tanggal harus diisi')
    .isDate().withMessage('Format deadline tanggal tidak valid'),
  body('deadline_waktu')
    .notEmpty().withMessage('Deadline waktu harus diisi')
    .isTime().withMessage('Format deadline waktu tidak valid'),
  body('tempat_pengumpulan')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('tugas/edit', {
      error: errors.array()[0].msg,
      tugas: { ...req.body, id: req.params.id }
    });
  }

  const { mata_kuliah, deskripsi, deadline_tanggal, deadline_waktu, tempat_pengumpulan, is_completed } = req.body;
  const { id } = req.params;
  const user_number = req.session.user_number;

  const query = `
    UPDATE tugas 
    SET mata_kuliah = ?, 
        deskripsi = ?, 
        deadline_tanggal = ?, 
        deadline_waktu = ?, 
        tempat_pengumpulan = ?,
        is_completed = ?,
        user_number = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  db.run(query, [
    mata_kuliah, 
    deskripsi, 
    deadline_tanggal, 
    deadline_waktu, 
    tempat_pengumpulan,
    is_completed ? 1 : 0,
    user_number,
    id
  ], (err) => {
    if (err) {
      console.error('Error updating task:', err);
      return res.render('tugas/edit', {
        error: 'Terjadi kesalahan saat mengupdate tugas',
        tugas: { ...req.body, id }
      });
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

// Function to check bot status
function checkBotStatus(callback) {
  exec('pm2 jlist', (error, stdout, stderr) => {
    if (error || stderr) {
      console.error('Error checking bot status:', error || stderr);
      callback(null, false);
      return;
    }

    try {
      // Parse JSON output from PM2
      const processes = JSON.parse(stdout);
      
      // Find bot process with ID 0
      const botProcess = processes.find(p => p.pm_id === 0);
      
      // Log for debugging
      console.log('PM2 processes:', processes);
      console.log('Bot process:', botProcess);
      
      if (!botProcess) {
        console.log('Bot process (ID 0) not found');
        callback(null, false);
        return;
      }

      // Check if status is 'online'
      const isRunning = botProcess.pm2_env.status === 'online';
      
      // Log final status
      console.log('Bot status check:', {
        processId: botProcess.pm_id,
        name: botProcess.name,
        status: botProcess.pm2_env.status,
        isRunning: isRunning
      });

      callback(null, isRunning);
    } catch (parseError) {
      console.error('Error parsing PM2 output:', parseError);
      console.error('Raw output:', stdout);
      callback(null, false);
    }
  });
}

// Bot Status Page
app.get('/bot-status', (req, res) => {
  checkBotStatus((error, isRunning) => {
    if (error) {
      console.error('Error checking bot status:', error);
      return res.status(500).send('Error checking bot status');
    }
    res.render('bot-status', { 
      isRunning,
      error: null,
      showPinForm: true
    });
  });
});

// Bot Status with PIN
app.post('/bot-status', authenticatePin, (req, res) => {
  checkBotStatus((error, isRunning) => {
    if (error) {
      console.error('Error checking bot status:', error);
      return res.status(500).send('Error checking bot status');
    }
    res.render('bot-status', { 
      isRunning,
      error: null,
      showPinForm: false
    });
  });
});

// Start Bot
app.post('/bot/start', authenticatePin, (req, res) => {
  checkBotStatus((error, isRunning) => {
    if (error) {
      return res.status(500).json({ success: false, message: 'Error checking bot status' });
    }

    if (isRunning) {
      return res.json({ success: true, message: 'Bot is already running' });
    }

    // Start bot using process ID
    exec('pm2 start 0', (startError, stdout, stderr) => {
      if (startError) {
        console.error('Error starting bot:', startError);
        return res.status(500).json({ success: false, message: 'Failed to start bot' });
      }

      // Verify the bot started successfully
      setTimeout(() => {
        checkBotStatus((verifyError, isNowRunning) => {
          if (verifyError || !isNowRunning) {
            return res.status(500).json({ success: false, message: 'Failed to verify bot started' });
          }
          res.json({ success: true, message: 'Bot started successfully' });
        });
      }, 2000);
    });
  });
});

// Stop Bot
app.post('/bot/stop', authenticatePin, (req, res) => {
  checkBotStatus((error, isRunning) => {
    if (error) {
      return res.status(500).json({ success: false, message: 'Error checking bot status' });
    }

    if (!isRunning) {
      return res.json({ success: true, message: 'Bot is already stopped' });
    }

    // Stop bot using process ID
    exec('pm2 stop 0', (stopError, stdout, stderr) => {
      if (stopError) {
        console.error('Error stopping bot:', stopError);
        return res.status(500).json({ success: false, message: 'Failed to stop bot' });
      }

      // Verify the bot stopped successfully
      setTimeout(() => {
        checkBotStatus((verifyError, isStillRunning) => {
          if (verifyError || isStillRunning) {
            return res.status(500).json({ success: false, message: 'Failed to verify bot stopped' });
          }
          res.json({ success: true, message: 'Bot stopped successfully' });
        });
      }, 2000);
    });
  });
});

// Start the server
app.listen(port, ip, () => {
  console.log(`Server running on http://${ip}:${port}`);
}); 
