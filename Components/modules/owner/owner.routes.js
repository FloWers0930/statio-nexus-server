// backend/src/modules/owner/owner.routes.js
const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const {
  Authenticate,
  restrictTo,
  requirePasswordChange,
} = require("../../middlewares/auth.js"); // ✅ Added requirePasswordChange
const {
  getOwnerSpots,
  createSpot,
  updateSpot,
  deleteSpot,
  getOwnerBookings,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  resendStaffInvite,
  performOCR,
  changePassword,
  enableTwoFactor,
  verifyTwoFactor,
  disableTwoFactor,
  getDashboardAnalytics,
  getAnalytics,
} = require("./owner.controller.js");

const router = express.Router();

const ocrLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    message: "Too many OCR requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const validateObjectId = (req, res, next) => {
  if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format" });
  }
  next();
};

// ── Protect all routes ────────────────────────────────────────────────────────
// ✅ Added requirePasswordChange to enforce first-login password update
router.use(Authenticate, requirePasswordChange, restrictTo("owner", "admin"));

// ── Dashboard summary (flat stats) ───────────────────────────────────────────
router.get("/dashboard", getDashboardAnalytics);

// ── Full analytics (stats + charts shape) ────────────────────────────────────
router.get("/analytics", getAnalytics);

// ── Staff Management ──────────────────────────────────────────────────────────
router.get("/staff", getStaff);
router.post("/staff", createStaff);
router.put("/staff/:id", validateObjectId, updateStaff);
router.delete("/staff/:id", validateObjectId, deleteStaff);
router.post("/staff/:id/resend-invite", validateObjectId, resendStaffInvite);

// ── Document OCR ──────────────────────────────────────────────────────────────
router.post("/documents/ocr", ocrLimiter, performOCR);

// ── Station Spots ─────────────────────────────────────────────────────────────
router.get("/spots", getOwnerSpots);
router.post("/spots", createSpot);
router.patch("/spots/:id", validateObjectId, updateSpot);
router.delete("/spots/:id", validateObjectId, deleteSpot);

// ── Bookings ──────────────────────────────────────────────────────────────────
router.get("/bookings", getOwnerBookings);

// ── Security & 2FA ────────────────────────────────────────────────────────────
router.post("/change-password", changePassword);
router.post("/enable-2fa", enableTwoFactor);
router.post("/verify-2fa", verifyTwoFactor);
router.post("/disable-2fa", disableTwoFactor);

module.exports = router;
