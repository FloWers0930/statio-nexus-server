// backend/src/modules/admin/admin.controller.js
const mongoose = require("mongoose");
const User = require("../shared/user.model.js");
const { z } = require("../../middlewares/validate.js");
const StationSpot = require("../shared/stationSpot.model.js");
const Booking = require("../shared/booking.model.js");
const Audit = require("../audit/audit.model.js");
// Helper: Escape regex special characters
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ==================== DASHBOARD STATS ====================
const getDashboardStats = async (req, res, next) => {
  try {
    // Define queries
    const userQuery = { role: { $nin: ["admin", "owner", "staff"] } };
    const spotBaseQuery = { isActive: true, deletedAt: { $exists: false } };
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Fetch all stats in parallel
    const [
      usersCount,
      totalSpots,
      totalBookings,
      revenueData,
      availableSpots,
      occupiedSpots,
      activeBookings,
      revenueChart,
      topLocations,
    ] = await Promise.all([
      // 1. User count (excluding staff/admin/owners)
      User.countDocuments(userQuery),

      // 2. Total active spots
      StationSpot.countDocuments(spotBaseQuery),

      // 3. Total valid bookings (non-cancelled)
      Booking.countDocuments({ status: { $ne: "cancelled" } }),

      // 4. Total Revenue
      Booking.aggregate([
        { $match: { paymentStatus: "paid", status: { $ne: "cancelled" } } },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),

      // 5. Available Spots
      StationSpot.countDocuments({ ...spotBaseQuery, status: "available" }),

      // 6. Occupied Spots
      StationSpot.countDocuments({ ...spotBaseQuery, status: "occupied" }),

      // 7. Active Bookings
      Booking.countDocuments({ status: "active" }),

      // 8. Revenue Chart (Last 7 days)
      Booking.aggregate([
        {
          $match: {
            paymentStatus: "paid",
            status: { $ne: "cancelled" },
            createdAt: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            revenue: { $sum: "$totalCost" },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 9. Top Locations by Revenue
      Booking.aggregate([
        { $match: { paymentStatus: "paid", status: { $ne: "cancelled" } } },
        {
          $lookup: {
            from: "stationspots",
            localField: "spot",
            foreignField: "_id",
            as: "spot",
          },
        },
        { $unwind: { path: "$spot", preserveNullAndEmptyArrays: true } },
        { $match: { "spot.deletedAt": { $exists: false } } },
        {
          $group: {
            _id: { $ifNull: ["$spot.location", "Unknown"] },
            revenue: { $sum: "$totalCost" },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
    ]);

    res.json({
      success: true,
      stats: {
        users: usersCount,
        spots: totalSpots,
        bookings: totalBookings,
        revenue: revenueData[0]?.total || 0,
        availableSpots,
        occupiedSpots,
        activeBookings,
        revenueChart: revenueChart || [],
        topLocations: topLocations || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== USER MANAGEMENT ====================

const getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    // Filter out platform staff
    const query = { role: { $nin: ["admin", "owner", "staff"] } };

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -passwordHash -salt -twoFactorSecret")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

const updateUserStatusSchema = z.object({ isActive: z.boolean() });

const updateUserStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ success: false, message: "isActive must be a boolean" });
    }

    const targetId = req.params.id;

    // Find old state for audit logging
    const oldUser = await User.findOne({
      _id: targetId,
      role: { $nin: ["admin", "owner", "staff"] },
    }).select("name email isActive role");

    if (!oldUser) {
      return res.status(404).json({
        success: false,
        message: "User not found or cannot modify platform staff",
      });
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      targetId,
      { isActive },
      { new: true, runValidators: true },
    ).select("-password -passwordHash -salt -twoFactorSecret");

    // Audit Log
    const emitAuditLog = req.app.locals?.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        action: "user_status_changed",
        details: `User status changed: ${user.email}`,
        oldValue: { isActive: oldUser.isActive },
        newValue: { isActive: user.isActive },
        isCritical: true,
      });
    }

    // Real-time Notification
    const notificationService = req.app.locals?.notificationService;
    if (notificationService) {
      notificationService.sendUserNotification({
        type: "userStatusChanged",
        userId: user._id,
        email: user.email,
        isActive,
        adminMessage: `User ${user.email} has been ${
          isActive ? "activated" : "deactivated"
        }`,
      });
    }

    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// ==================== SPOT MANAGEMENT ====================

const getAllSpots = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const skip = (page - 1) * limit;

    const [spots, total] = await Promise.all([
      StationSpot.aggregate([
        { $match: { deletedAt: { $exists: false } } },
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
          },
        },
        { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            "owner.password": 0,
            "owner.passwordHash": 0,
            "owner.refreshToken": 0,
            "owner.twoFactorSecret": 0,
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
      StationSpot.countDocuments({ deletedAt: { $exists: false } }),
    ]);

    res.json({
      success: true,
      spots,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== BOOKING MANAGEMENT ====================

const getAllBookings = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      Booking.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $lookup: {
            from: "stationspots",
            localField: "spot",
            foreignField: "_id",
            as: "spot",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$spot", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            "user.password": 0,
            "user.passwordHash": 0,
            "user.refreshToken": 0,
            "user.twoFactorSecret": 0,
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
      Booking.countDocuments(),
    ]);

    res.json({
      success: true,
      bookings,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== AUDIT LOGS ====================

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

    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid userId format" });
      }
      match.user = new mongoose.Types.ObjectId(userId);
    }

    if (action) match.action = action;
    if (critical === "true") match.isCritical = true;

    if (search) {
      match.$or = [
        { details: { $regex: escapeRegex(search), $options: "i" } },
        { action: { $regex: escapeRegex(search), $options: "i" } },
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
          "user.passwordHash": 0,
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

// ==================== SETTINGS ====================

const updateSettingsSchema = z.object({
  appName: z.string().min(1).max(100).optional(),
  supportEmail: z.string().email().optional(),
  currency: z.string().length(3).optional(),
  autoCancel: z.boolean().optional(),
  waitlist: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
});

const getSettings = async (req, res, next) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const {
      appName,
      supportEmail,
      currency,
      autoCancel,
      waitlist,
      maintenanceMode,
    } = req.body;

    const oldSettings = await Settings.findOne();

    let settings;
    if (!oldSettings) {
      settings = await Settings.create({
        appName,
        supportEmail,
        currency,
        autoCancel,
        waitlist,
        maintenanceMode,
      });
    } else {
      // Update only provided fields
      if (appName !== undefined) oldSettings.appName = appName;
      if (supportEmail !== undefined) oldSettings.supportEmail = supportEmail;
      if (currency !== undefined) oldSettings.currency = currency;
      if (autoCancel !== undefined) oldSettings.autoCancel = autoCancel;
      if (waitlist !== undefined) oldSettings.waitlist = waitlist;
      if (maintenanceMode !== undefined)
        oldSettings.maintenanceMode = maintenanceMode;

      await oldSettings.save();
      settings = oldSettings;
    }

    // Audit Log
    const emitAuditLog = req.app.locals?.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        action: "settings_updated",
        details: "Admin updated system settings",
        oldValue: oldSettings ? oldSettings.toObject() : null,
        newValue: settings.toObject(),
        isCritical: true,
      });
    }

    // Notification
    const notificationService = req.app.locals?.notificationService;
    if (notificationService) {
      notificationService.sendGlobalNotification({
        type: "settingsUpdated",
        settings,
        adminMessage: "System settings have been updated",
      });
    }

    res.json({
      success: true,
      message: "Settings updated successfully",
      settings,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getAllUsers,
  updateUserStatus,
  getAllSpots,
  getAllBookings,
  getAuditLog,
  getSettings,
  updateSettings,
  updateUserStatusSchema,
  updateSettingsSchema,
};
