const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("app.db");

console.log("\n=== RESETTING DATABASE ===\n");

db.serialize(() => {
  // Drop existing tables
  db.run("DROP TABLE IF EXISTS messages", (err) => {
    if (err) console.error("Error dropping messages:", err);
    else console.log("✓ Dropped messages table");
  });
  
  db.run("DROP TABLE IF EXISTS users", (err) => {
    if (err) console.error("Error dropping users:", err);
    else console.log("✓ Dropped users table");
  });
  
  // Recreate tables with correct structure
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    profile_picture TEXT DEFAULT NULL,
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Error creating users:", err);
    else console.log("✓ Created users table");
  });
  
  db.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message TEXT,
    file_path TEXT DEFAULT NULL,
    file_type TEXT DEFAULT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error("Error creating messages:", err);
    else console.log("✓ Created messages table");
  });
  
  setTimeout(() => {
    console.log("\n✅ Database reset complete! You can now register new users.\n");
    db.close();
  }, 1000);
});