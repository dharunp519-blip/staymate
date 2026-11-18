const jwt = require("jsonwebtoken");
const db = require("../config/db");

async function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const [sessions] = await db.execute(
      "SELECT user_id FROM auth_sessions WHERE jti = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()",
      [claims.jti]
    );
    if (!sessions.length || sessions[0].user_id !== claims.sub) {
      return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
    const [users] = await db.execute(
      "SELECT id, name, email FROM users WHERE id = ?",
      [claims.sub]
    );
    if (!users.length) return res.status(401).json({ error: "Account not found." });
    req.user = users[0];
    req.tokenClaims = claims;
    req.token = token;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid or expired authentication token." });
    }
    return next(error);
  }
}

module.exports = authenticate;
