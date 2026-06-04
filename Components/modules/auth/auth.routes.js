// backend/src/modules/auth/auth.routes.js
// Authentication routes

const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  login,
  register,
  getMe,
  logout,
  changePassword,
  refreshToken,
} = require("./auth.controller.js");
const { Authenticate } = require("../../middlewares/auth.js");

const router = express.Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

// ✅ Fixed: 5 attempts per 15 minutes (was incorrectly set to 100)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many token refresh attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ====================== PUBLIC ROUTES ======================
router.post("/login", loginLimiter, login);
router.post("/register", loginLimiter, register);
router.post("/refresh", refreshLimiter, refreshToken);

// ====================== PROTECTED ROUTES ======================
router.get("/me", Authenticate, getMe);
router.post("/logout", Authenticate, logout);
router.post("/change-password", Authenticate, changePassword);

module.exports = router;
