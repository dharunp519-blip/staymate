const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

function tokenExpiryDate(expiresIn) {
  const match = /^(\d+)([dhm])$/.exec(expiresIn);
  if (!match) throw new Error("JWT_EXPIRES_IN must be a value such as 7d, 12h, or 30m.");
  const multiplier = { m: 60, h: 3600, d: 86400 }[match[2]];
  return new Date(Date.now() + Number(match[1]) * multiplier * 1000);
}

async function issueSession(user) {
  const jti = crypto.randomUUID();
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  const token = jwt.sign({ sub: user.id, jti }, process.env.JWT_SECRET, { expiresIn });
  await db.execute(
    "INSERT INTO auth_sessions (jti, user_id, expires_at) VALUES (?, ?, ?)",
    [jti, user.id, tokenExpiryDate(expiresIn)]
  );
  return { token, user: { id: user.id, name: user.name, email: user.email } };
}

async function register(req, res, next) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (name.length < 1 || name.length > 100) return res.status(400).json({ error: "Name must be between 1 and 100 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  try {
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", [id, name, email, passwordHash]);
    const session = await issueSession({ id, name, email });
    return res.status(201).json(session);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with that email already exists." });
    return next(error);
  }
}

async function login(req, res, next) {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  try {
    const [users] = await db.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email]);
    if (!users.length || !(await bcrypt.compare(password, users[0].password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    return res.json(await issueSession(users[0]));
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    await db.execute("UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP() WHERE jti = ?", [req.tokenClaims.jti]);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = { register, login, logout, me };
