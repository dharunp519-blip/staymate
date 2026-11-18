const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const db = require("./config/db");
const authenticate = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const workspaceRoutes = require("./routes/workspace");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("Set JWT_SECRET to a random value of at least 32 characters in .env.");
}

const app = express();
const port = Number(process.env.PORT || 3000);
const projectRoot = __dirname;
const frontendOrigins = new Set((process.env.FRONTEND_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean));

function databaseTarget() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    database: process.env.DB_NAME
  };
}

async function logDatabaseStatus() {
  try {
    await db.query("SELECT 1");
    console.info("RoomSync connected to MySQL.", databaseTarget());
  } catch (error) {
    console.error("RoomSync could not connect to MySQL.", {
      ...databaseTarget(),
      code: error.code || "UNKNOWN"
    });
  }
}

function isLocalDevelopmentOrigin(origin) {
  try {
    const url = new URL(origin);
    return process.env.NODE_ENV !== "production" &&
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

app.use((req, res, next) => cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      if (new URL(origin).origin === new URL(`${req.protocol}://${req.get("host")}`).origin) {
        return callback(null, true);
      }
    } catch {
      return callback(new Error("Origin is not allowed by CORS."));
    }
    if (frontendOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600
})(req, res, next));

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false, limit: "12mb" }));
app.use("/uploads", express.static(path.join(projectRoot, "uploads"), {
  fallthrough: false,
  immutable: true,
  maxAge: "1y",
  setHeaders(res) { res.setHeader("X-Content-Type-Options", "nosniff"); }
}));

app.get("/api/health", async (req, res, next) => {
  try {
    await db.query("SELECT 1");
    return res.json({ status: "ok", database: "connected" });
  } catch (error) { return next(error); }
});
app.use("/api/auth", authRoutes);
app.use("/api", authenticate, workspaceRoutes);

for (const file of ["index.html", "style.css", "script.js"]) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(projectRoot, file)));
}
app.get("/", (req, res) => res.sendFile(path.join(projectRoot, "index.html")));
app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "This frontend origin is not allowed. Add it to FRONTEND_ORIGINS." });
  }
  if (error.code === "ECONNREFUSED") {
    console.error("RoomSync could not connect to MySQL.", { ...databaseTarget(), code: error.code });
    return res.status(503).json({ error: "MySQL is unavailable. Start MySQL and check DB_HOST and DB_PORT." });
  }
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("RoomSync could not authenticate with MySQL.", { ...databaseTarget(), code: error.code });
    return res.status(503).json({ error: "MySQL rejected the configured credentials. Check DB_USER and DB_PASSWORD." });
  }
  if (error.code === "ER_BAD_DB_ERROR") {
    console.error("RoomSync database was not found.", { ...databaseTarget(), code: error.code });
    return res.status(503).json({ error: "The configured MySQL database was not found. Create it from database.sql and check DB_NAME." });
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body contains invalid JSON." });
  }
  if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Each image must be 2 MB or smaller." });
  if (error.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: "You can upload at most 5 images at once." });
  if (error.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Use the images field and upload no more than 5 files at once." });
  if (error.message && /Only JPEG, PNG/.test(error.message)) return res.status(400).json({ error: error.message });
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error("RoomSync request failed:", error);
  return res.status(500).json({ error: "The server could not complete this request." });
});

app.listen(port, () => {
  console.log(`RoomSync is running at http://localhost:${port}`);
  void logDatabaseStatus();
});
