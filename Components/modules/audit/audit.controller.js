// backend/src/modules/audit/audit.controller.js
const mongoose = require("mongoose");
const Audit = require("./audit.model");

// Escape regex special characters to prevent ReDoS attacks
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAuditLog = async (req, res, next) => {
  try {
    const {
      limit = 100,
      action,
      critical,
      search,
      fromDate,
      toDate,
      timezone,
      userId,
    } = req.query;

    const match = {};

    // 🔴 CRITICAL FIX: Owners should only see their own audit logs
    // Admins can see everything, but owners must be restricted
    if (req.user.role === "owner") {
      match.user = req.user._id;
    } else if (userId) {
      // Admins can filter by specific users
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid userId format",
        });
      }
      match.user = new mongoose.Types.ObjectId(userId);
    }

    if (action) match.action = action;
    if (critical === "true") match.isCritical = true;

    if (search) {
      match.$or = [
        { details: { $regex: escapeRegex(search), $options: "i" } },
        { action: { $regex: escapeRegex(search), $options: "i" } },
        { userName: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    if (fromDate || toDate) {
      match.createdAt = {};
      const tzOffset = timezone ? parseInt(timezone) : 0;
      const offsetMs = tzOffset * 60 * 1000;

      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        match.createdAt.$gte = new Date(from.getTime() - offsetMs);
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        match.createdAt.$lte = new Date(to.getTime() - offsetMs);
      }
    }

    // Cap limit to prevent memory exhaustion
    const safeLimit = Math.min(parseInt(limit) || 100, 500);

    const activities = await Audit.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          "user.password": 0,
          "user.refreshToken": 0,
          "user.twoFactorSecret": 0,
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: safeLimit },
    ]);

    res.json({ success: true, activities, count: activities.length });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAuditLog };
