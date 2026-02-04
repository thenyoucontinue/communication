// server.js - REPLACE YOUR CODE WITH THIS:
const express = require("express");
const session = require("express-session");
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const db = new Database('messenger.db');  // SINGLE DATABASE CONNECTION
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require('nodemailer');

// Email verification storage
const verificationCodes = new Map();

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'parsadarayavauh0020@gmail.com',
    pass: process.env.GMAIL_PASS || 'btudccnpjhrqfujt'
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create uploads directory if it doesn't exist
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only images and videos are allowed"));
    }
  }
});

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: "devsecret123",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Serve static files
app.use(express.static(__dirname));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app.html"));
});

// Username validation function
function isValidUsername(username) {
  // Only allow letters, numbers, and underscore
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  return usernameRegex.test(username) && username.length >= 3;
}

// Generate 6-digit verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send verification email
function sendVerificationEmail(email, code) {
  transporter.sendMail({
    from: 'ifneed0020@gmail.com',
    to: email,
    subject: 'Verify Your Email - Messenger',
    html: `<h1>Your verification code: ${code}</h1><p>Valid for 10 minutes</p>`
  }, (error, info) => {
    if (error) {
      console.log('Email error:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

// Send password reset email
function sendPasswordResetEmail(email, code) {
  transporter.sendMail({
    from: 'ifneed0020@gmail.com',
    to: email,
    subject: 'Reset Your Password - Messenger',
    html: `<h1>Password Reset Code: ${code}</h1><p>Valid for 10 minutes</p><p>If you didn't request this, ignore this email.</p>`
  }, (error, info) => {
    if (error) {
      console.log('Email error:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

// Register endpoint with email verification
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Validate username - only letters, numbers, and underscore
    if (!isValidUsername(username)) {
      return res.status(400).json({ 
        error: "Username must be at least 3 characters and contain only letters, numbers, and underscores (_). No spaces or special characters allowed!" 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format. Please use a valid email (e.g., user@example.com)" });
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long" });
    }

    // Check if username already exists
    const existingUser = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Check if email already exists
    const existingEmail = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

    if (existingEmail) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Generate verification code and token
    const verificationCode = generateVerificationCode();
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    // Store verification data (expires in 10 minutes)
    verificationCodes.set(verificationToken, {
      code: verificationCode,
      username,
      email,
      password,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
    });

    // Send verification email
    sendVerificationEmail(email, verificationCode);

    // Clean up expired codes
    setTimeout(() => {
      if (verificationCodes.has(verificationToken)) {
        const data = verificationCodes.get(verificationToken);
        if (Date.now() > data.expiresAt) {
          verificationCodes.delete(verificationToken);
        }
      }
    }, 10 * 60 * 1000);

    res.json({ 
      success: true, 
      message: "Verification code sent to your email",
      verificationToken: verificationToken
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Verify email endpoint
app.post("/verify-email", async (req, res) => {
  try {
    const { code, token, attempts } = req.body;
    
    if (!code || !token) {
      return res.status(400).json({ error: "Code and token required" });
    }

    // Check if token exists
    if (!verificationCodes.has(token)) {
      return res.status(400).json({ error: "Invalid or expired verification token. Please register again." });
    }

    const verificationData = verificationCodes.get(token);

    // Check if token has expired
    if (Date.now() > verificationData.expiresAt) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Verification code expired. Please register again." });
    }

    // Check if too many attempts
    if (attempts > 3 || verificationData.attempts >= 3) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Too many incorrect attempts. Please register again." });
    }

    // Verify the code
    if (code !== verificationData.code) {
      verificationData.attempts++;
      verificationCodes.set(token, verificationData);
      
      const remainingAttempts = 3 - verificationData.attempts;
      if (remainingAttempts <= 0) {
        verificationCodes.delete(token);
        return res.status(400).json({ error: "Too many incorrect attempts. Please register again." });
      }
      
      return res.status(400).json({ 
        error: `Incorrect code. ${remainingAttempts} attempt(s) remaining.` 
      });
    }

    // Code is correct, create the user
    const hash = await bcrypt.hash(verificationData.password, 10);
    
    const stmt = db.prepare("INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, ?)");
    const result = stmt.run(verificationData.username, verificationData.email, hash, 1);
    const userId = result.lastInsertRowid;

    // Delete the verification code
    verificationCodes.delete(token);

    // Auto-login after verification
    req.session.userId = userId;
    req.session.username = verificationData.username;

    res.json({ 
      success: true, 
      message: "Email verified successfully",
      userId: userId,
      username: verificationData.username
    });

  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Forgot password endpoint
app.post("/forgot-password", async (req, res) => {
  try {
    const { emailOrUsername } = req.body;
    
    if (!emailOrUsername) {
      return res.status(400).json({ error: "Email or username required" });
    }

    // Check if user exists by email or username
    const user = db.prepare("SELECT id, username, email FROM users WHERE email = ? OR username = ?").get(emailOrUsername, emailOrUsername);

    if (!user) {
      return res.status(400).json({ error: "No account found with this email or username" });
    }

    // Generate reset code and token
    const resetCode = generateVerificationCode();
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Store reset data (expires in 10 minutes)
    verificationCodes.set(resetToken, {
      code: resetCode,
      email: user.email,
      userId: user.id,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000)
    });

    // Send reset email
    sendPasswordResetEmail(user.email, resetCode);

    // Mask email for display (show first 2 chars and domain)
    const emailParts = user.email.split('@');
    const maskedEmail = emailParts[0].substring(0, 2) + '****@' + emailParts[1];

    // Clean up expired codes
    setTimeout(() => {
      if (verificationCodes.has(resetToken)) {
        const data = verificationCodes.get(resetToken);
        if (Date.now() > data.expiresAt) {
          verificationCodes.delete(resetToken);
        }
      }
    }, 10 * 60 * 1000);

    res.json({ 
      success: true, 
      message: "Reset code sent to your email",
      resetToken: resetToken,
      maskedEmail: maskedEmail
    });

  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Reset password endpoint
app.post("/reset-password", async (req, res) => {
  try {
    const { code, token, newPassword, attempts } = req.body;
    
    if (!code || !token || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }

    // Check if token exists
    if (!verificationCodes.has(token)) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const resetData = verificationCodes.get(token);

    // Check if token has expired
    if (Date.now() > resetData.expiresAt) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Reset code expired. Please try again." });
    }

    // Check attempts
    if (attempts > 3 || resetData.attempts >= 3) {
      verificationCodes.delete(token);
      return res.status(400).json({ error: "Too many incorrect attempts" });
    }

    // Verify the code
    if (code !== resetData.code) {
      resetData.attempts++;
      verificationCodes.set(token, resetData);
      
      const remainingAttempts = 3 - resetData.attempts;
      if (remainingAttempts <= 0) {
        verificationCodes.delete(token);
        return res.status(400).json({ error: "Too many incorrect attempts" });
      }
      
      return res.status(400).json({ 
        error: `Incorrect code. ${remainingAttempts} attempt(s) remaining.` 
      });
    }

    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Update password
    const hash = await bcrypt.hash(newPassword, 10);
    
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, resetData.userId);

    // Delete the reset token
    verificationCodes.delete(token);

    res.json({ 
      success: true, 
      message: "Password reset successfully"
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Login endpoint - accepts both username and email
app.post("/login", async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: "Username/Email and password required" });
    }

    // Find user by username or email
    const user = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(usernameOrEmail, usernameOrEmail);
    
    if (!user) {
      return res.status(401).json({ error: "Invalid username/email or password" });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid username/email or password" });
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

// Logout endpoint
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

// Update profile endpoint
app.post("/profile/update", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  const { email, bio } = req.body;
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  if (email && !emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  
  // Check if email is taken by another user
  const emailUser = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, req.session.userId);
  if (emailUser) {
    return res.status(400).json({ error: "Email already in use" });
  }
  
  try {
    db.prepare("UPDATE users SET email = ?, bio = ? WHERE id = ?").run(email || "", bio || "", req.session.userId);
    res.json({ success: true, message: "Profile updated" });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Upload profile picture
app.post("/profile/picture", upload.single("profilePicture"), (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  
  const filePath = "/uploads/" + req.file.filename;
  
  try {
    db.prepare("UPDATE users SET profile_picture = ? WHERE id = ?").run(filePath, req.session.userId);
    res.json({ success: true, filePath: filePath });
  } catch (err) {
    console.error("Update profile picture error:", err);
    res.status(500).json({ error: "Failed to update profile picture" });
  }
});

// Typing indicator storage
const typingUsers = new Map();

// Get all users with unread message counts and typing status
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
    
    // Add typing status to each user
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
    console.error("Search users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Typing indicator endpoints
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
  
  // Clear typing indicator after 3 seconds
  setTimeout(() => {
    const data = typingUsers.get(key);
    if (data && Date.now() - data.timestamp >= 3000) {
      typingUsers.delete(key);
    }
  }, 3000);
  
  res.json({ success: true });
});

// Send message (text only)
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
    console.error("Send message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Send message with file
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
    console.error("Send file message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Get messages with typing status
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
    
    // Check if other user is typing
    const key = `${otherUserId}-${req.session.userId}`;
    const typingData = typingUsers.get(key);
    const isTyping = typingData && (Date.now() - typingData.timestamp < 3000);
    
    res.json({
      messages: messages,
      is_typing: isTyping
    });
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark messages as read
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

// Initialize database tables
function initializeDatabase() {
  // Create users table
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
  
  // Create messages table
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
  
  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver 
    ON messages(sender_id, receiver_id, timestamp)
  `);
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_unread 
    ON messages(sender_id, receiver_id, is_read) 
    WHERE is_read = 0
  `);
}

// Initialize database on startup
initializeDatabase();

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Messenger server running at http://localhost:${PORT}`);
  console.log(`📝 Open your browser and go to http://localhost:${PORT}`);
});