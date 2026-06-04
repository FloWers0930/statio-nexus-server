// backend/src/modules/admin/admin.routes.js
const express = require("express");
const mongoose = require("mongoose");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const { validateBody } = require("../../middlewares/validate.js");
const {
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  getAllSpots,
  getAllBookings,
  updateUserStatusSchema,
} = require("./admin.controller.js");

const router = express.Router();

const validateObjectId = (req, res, next) => {
  if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format" });
  }
  next();
};

// All routes require authentication
router.use(Authenticate);

// ─── Admin-only routes ────────────────────────────────────────────────────────
// ⚠️ WARNING: All routes below are admin-only.
router.use(restrictTo("admin"));

router.get("/dashboard", getDashboardStats);
router.get("/users", getAllUsers);
router.patch(
  "/users/:id/status",
  validateObjectId,
  validateBody(updateUserStatusSchema),
  updateUserStatus,
);
router.get("/spots", getAllSpots);
router.get("/bookings", getAllBookings);

module.exports = router;
