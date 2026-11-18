const mysql = require("mysql2/promise");

const requiredSettings = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missingSettings = requiredSettings.filter((setting) => !process.env[setting]);
if (missingSettings.length) {
  throw new Error(`Missing MySQL configuration in .env: ${missingSettings.join(", ")}.`);
}

const port = Number(process.env.DB_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DB_PORT must be a valid TCP port number.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ...(process.env.DB_SSL === "true" ? { ssl: {} } : {}),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4"
});

module.exports = pool;
