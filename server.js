const express = require("express");
const session = require("express-session");
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const db = new Database('messenger.db', { verbose: console.log });
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require('nodemailer');

// Email verification storage
const verificationCodes = new Map();

// Configure email transporter
const createTransporter = () => {
  const emailUser = process.env.GMAIL_USER || 'parsadarayavauh0020@gmail.com';
  const emailPass = process.env.GMAIL_PASS || 'btudccnpjhrqfujt';
  
  console.log('Email config loaded');
  
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass
    }
  });
};

const transporter = createTransporter();

// Verify transporter
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('Email transporter ready');
  }
});

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only images and videos allowed"));
    }
  }
});

const app = express();

// Session configuration
const sessionConfig = {
  secret: process.env.SESSION_SECRET || "devsecret123",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
};

if (process.env.NODE_ENV === 'production') {
  const MemoryStore = require('memorystore')(session);
  sessionConfig.store = new MemoryStore({
    checkPeriod: 86400000
  });
}

// Middleware - IMPORTANT: order matters!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionConfig));

// Serve ALL static files from the root directory
app.use(express.static(path.join(__dirname)));

// Serve uploads separately
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Debug middleware to log requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Home route - serve app.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    time: new Date().toISOString()
  });
});

// Username validation
function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username) && username.length >= 3;
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendVerificationEmail(email, code) {
  return new Promise((resolve, reject) => {
    const mailOptions = {
      from: process.env.GMAIL_USER || 'parsadarayavauh0020@gmail.com',
      to: email,
      subject: 'Verify Your Email - Messenger',
      html: `<h2>Your verification code: ${code}</h2><p>Valid for 10 minutes</p>`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Email error:', error);
        reject(error);
      } else {
        console.log('Email sent to:', email);
        resolve(info);
      }
    });
  });
}

function sendPasswordResetEmail(email, code) {
  return new Promise((resolve, reject) => {
    const mailOptions = {
      from: process.env.GMAIL_USER || 'parsadarayavauh0020@gmail.com',
      to: email,
      subject: 'Password Reset - Messenger',
      html: `<h2>Reset code: ${code}</h2><p>Valid for 10 minutes</p>`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Reset email error:', error);
        reject(error);
      } else {
        console.log('Reset email sent to:', email);
        resolve(info);
      }
    });
  });
}

// Register endpoint
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ 
        error: "Username: 3+ chars, letters/numbers/_ only" 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be 6+ chars" });
    }

    const existingUser = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (existingUser) {
      return res.status(400).json({ error: "Username exists" });
    }

    const existingEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existingEmail) {
      return res.status(400).json({ error: "Email registered" });
    }

    const verificationCode = generateVerificationCode();
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    verificationCodes.set(verificationToken, {
      code: verificationCode,
      username,
      email,
      password,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    try {
      await sendVerificationEmail(email, verificationCode);
    } catch (emailError) {
      console.error('Email failed:', emailError);
      // For debugging on Render, return code in response
      return res.json({ 
        success: true, 
        message: "Debug: Code (email service down)",
        verificationToken: verificationToken,
        debugCode: verificationCode
      });
    }

    setTimeout(() => {
      if (verificationCodes.has(verificationToken)) {
        verificationCodes.delete(verificationToken);
      }
    }, 10 * 60 * 1000);

    res.json({ 
      success: true, 
      message: "Verification code sent",
      verificationToken: verificationToken
    });

  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Verify email
app.post("/verify-email", async (req, res) => {
  try {
    const { code, token, attempts } = req.body;
    
    if (!code || !token) {
      return res.status(400).json({ error: "Code and token required" });
    }

    if (!verificationCodes.has(token)) {
      return res.status(400).json({ error: "Invalid token" });
    }

    const verificationData = verificationCodes.get(token);

    if (Date.now() > verificationData.expiresAt) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Code expired" });
    }

    if (attempts > 3 || verificationData.attempts >= 3) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Too many attempts" });
    }

    if (code !== verificationData.code) {
      verificationData.attempts++;
      verificationCodes.set(token, verificationData);
      
      const remainingAttempts = 3 - verificationData.attempts;
      if (remainingAttempts <= 0) {
        verificationCodes.delete(token);
        return res.status(400).json({ error: "Too many attempts" });
      }
      
      return res.status(400).json({ 
        error: `Incorrect. ${remainingAttempts} tries left.` 
      });
    }

    const hash = await bcrypt.hash(verificationData.password, 10);
    
    const stmt = db.prepare("INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, ?)");
    const result = stmt.run(verificationData.username, verificationData.email, hash, 1);
    const userId = result.lastInsertRowid;

    verificationCodes.delete(token);

    req.session.userId = userId;
    req.session.username = verificationData.username;

    res.json({ 
      success: true, 
      message: "Email verified",
      userId: userId,
      username: verificationData.username
    });

  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Forgot password
app.post("/forgot-password", async (req, res) => {
  try {
    const { emailOrUsername } = req.body;
    
    if (!emailOrUsername) {
      return res.status(400).json({ error: "Email/username required" });
    }

    const user = db.prepare("SELECT id, username, email FROM users WHERE email = ? OR username = ?").get(emailOrUsername, emailOrUsername);

    if (!user) {
      return res.status(400).json({ error: "No account found" });
    }

    const resetCode = generateVerificationCode();
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    verificationCodes.set(resetToken, {
      code: resetCode,
      email: user.email,
      userId: user.id,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    try {
      await sendPasswordResetEmail(user.email, resetCode);
    } catch (emailError) {
      console.error('Reset email failed:', emailError);
      return res.json({ 
        success: true, 
        message: "Debug: Reset code (email down)",
        resetToken: resetToken,
        debugCode: resetCode,
        maskedEmail: "email@debug.com"
      });
    }

    const emailParts = user.email.split('@');
    const maskedEmail = emailParts[0].substring(0, 2) + '****@' + emailParts[1];

    setTimeout(() => {
      if (verificationCodes.has(resetToken)) {
        verificationCodes.delete(resetToken);
      }
    }, 10 * 60 * 1000);

    res.json({ 
      success: true, 
      message: "Reset code sent",
      resetToken: resetToken,
      maskedEmail: maskedEmail
    });

  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Reset password
app.post("/reset-password", async (req, res) => {
  try {
    const { code, token, newPassword, attempts } = req.body;
    
    if (!code || !token || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }

    if (!verificationCodes.has(token)) {
      return res.status(400).json({ error: "Invalid token" });
    }

    const resetData = verificationCodes.get(token);

    if (Date.now() > resetData.expiresAt) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Code expired" });
    }

    if (attempts > 3 || resetData.attempts >= 3) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Too many attempts" });
    }

    if (code !== resetData.code) {
      resetData.attempts++;
      verificationCodes.set(token, resetData);
      
      const remainingAttempts = 3 - resetData.attempts;
      if (remainingAttempts <= 0) {
        verificationCodes.delete(token);
        return res.status(400).json({ error: "Too many attempts" });
      }
      
      return res.status(400).json({ 
        error: `Incorrect. ${remainingAttempts} tries left.` 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password 6+ chars" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, resetData.userId);

    verificationCodes.delete(token);

    res.json({ 
      success: true, 
      message: "Password reset"
    });

  } catch (error) {
    console.error("Reset error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: "Username/email and password required" });
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(usernameOrEmail, usernameOrEmail);
    
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    req.session.userId = user.id;
    req.session.username = user.username;
    
    res.json({ 
      success: true, 
      message: "Login successful",
      userId: user.id,
      username: user.username,
      profile_picture: user.profile_picture
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: "Logged out" });
});

// Get current user
app.get("/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const user = db.prepare("SELECT id, username, email, profile_picture, bio FROM users WHERE id = ?").get(req.session.userId);
  if (!user) {
    return res.status(500).json({ error: "Server error" });
  }
  res.json(user);
});

// Update profile
app.post("/profile/update", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { email, bio } = req.body;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  if (email && !emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  
  const emailUser = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, req.session.userId);
  if (emailUser) {
    return res.status(400).json({ error: "Email in use" });
  }
  
  try {
    db.prepare("UPDATE users SET email = ?, bio = ? WHERE id = ?").run(email || "", bio || "", req.session.userId);
    res.json({ success: true, message: "Profile updated" });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Upload profile picture
app.post("/profile/picture", upload.single("profilePicture"), (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: "No file" });
  }
  
  const filePath = "/uploads/" + req.file.filename;
  
  try {
    db.prepare("UPDATE users SET profile_picture = ? WHERE id = ?").run(filePath, req.session.userId);
    res.json({ success: true, filePath: filePath });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Typing storage
const typingUsers = new Map();

// Get all users
app.get("/users", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  try {
    const users = db.prepare(`
      SELECT u.id, u.username, u.profile_picture, u.bio,
            (SELECT COUNT(*) FROM messages 
             WHERE sender_id = u.id 
             AND receiver_id = ? 
             AND is_read = 0) as unread_count
      FROM users u
      WHERE u.id != ?
    `).all(req.session.userId, req.session.userId);
    
    users.forEach(user => {
      const key = `${user.id}-${req.session.userId}`;
      const typingData = typingUsers.get(key);
      user.is_typing = typingData && (Date.now() - typingData.timestamp < 3000);
    });
    
    res.json(users);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Search users
app.get("/users/search", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const query = req.query.q || "";
  
  try {
    const users = db.prepare(
      "SELECT id, username, profile_picture, bio FROM users WHERE id != ? AND username LIKE ?"
    ).all(req.session.userId, `%${query}%`);
    
    res.json(users);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Typing
app.post("/typing", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { to } = req.body;
  const key = `${req.session.userId}-${to}`;
  
  typingUsers.set(key, {
    from: req.session.userId,
    to: to,
    timestamp: Date.now()
  });
  
  setTimeout(() => {
    const data = typingUsers.get(key);
    if (data && Date.now() - data.timestamp >= 3000) {
      typingUsers.delete(key);
    }
  }, 3000);
  
  res.json({ success: true });
});

// Send message
app.post("/send", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { to, message } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: "Recipient and message required" });
  }
  
  try {
    const stmt = db.prepare("INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)");
    const result = stmt.run(req.session.userId, to, message);
    
    res.json({ success: true, message: "Message sent", messageId: result.lastInsertRowid });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: "Send failed" });
  }
});

// Send file
app.post("/send/file", upload.single("file"), (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { to, message } = req.body;
  
  if (!to) {
    return res.status(400).json({ error: "Recipient required" });
  }
  
  let filePath = null;
  let fileType = null;
  
  if (req.file) {
    filePath = "/uploads/" + req.file.filename;
    fileType = req.file.mimetype.startsWith("video/") ? "video" : "image";
  }
  
  try {
    const stmt = db.prepare(
      "INSERT INTO messages (sender_id, receiver_id, message, file_path, file_type) VALUES (?, ?, ?, ?, ?)"
    );
    const result = stmt.run(req.session.userId, to, message || "", filePath, fileType);
    
    res.json({ 
      success: true, 
      message: "Message sent", 
      messageId: result.lastInsertRowid,
      filePath: filePath,
      fileType: fileType
    });
  } catch (err) {
    console.error("File send error:", err);
    res.status(500).json({ error: "Send failed" });
  }
});

// Get messages
app.get("/messages/:userId", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const otherUserId = req.params.userId;
  
  try {
    const messages = db.prepare(`
      SELECT m.*, 
            sender.username as sender_username,
            sender.profile_picture as sender_picture,
            receiver.username as receiver_username,
            receiver.profile_picture as receiver_picture
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
        OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.timestamp ASC
    `).all(req.session.userId, otherUserId, otherUserId, req.session.userId);
    
    const key = `${otherUserId}-${req.session.userId}`;
    const typingData = typingUsers.get(key);
    const isTyping = typingData && (Date.now() - typingData.timestamp < 3000);
    
    res.json({
      messages: messages,
      is_typing: isTyping
    });
  } catch (err) {
    console.error("Messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark read
app.post("/messages/mark-read", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { from } = req.body;
  
  try {
    db.prepare(
      "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0"
    ).run(from, req.session.userId);
    
    res.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Initialize database
function initializeDatabase() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        profile_picture TEXT DEFAULT '',
        bio TEXT DEFAULT '',
        email_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        message TEXT DEFAULT '',
        file_path TEXT DEFAULT '',
        file_type TEXT DEFAULT '',
        is_read INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
      )
    `);
    
    console.log('Database ready');
  } catch (error) {
    console.error('DB init error:', error);
  }
}

// TEST ROUTE
app.get("/test-button", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Test</title></head>
    <body>
        <h1>Server is working!</h1>
        <button onclick="alert('Button works!')">Test Button</button>
    </body>
    </html>
  `);
});

initializeDatabase();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});