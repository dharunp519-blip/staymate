const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/authController");
const authenticate = require("../middleware/auth");

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again later." }
});

router.post("/register", loginLimiter, controller.register);
router.post("/login", loginLimiter, controller.login);
router.post("/logout", authenticate, controller.logout);
router.get("/me", authenticate, controller.me);

module.exports = router;
