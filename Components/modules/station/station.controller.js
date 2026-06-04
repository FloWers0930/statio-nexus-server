// backend/src/modules/station/station.controller.js
// Station & Booking controller - Public spot browsing + owner facility management + user booking flow

const mongoose = require("mongoose");
const StationSpot = require("../shared/stationSpot.model.js");
const Booking = require("../shared/booking.model.js");

// ==================== HELPERS ====================
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ==================== PUBLIC ROUTES (No login required) ====================

const getSpots = async (req, res, next) => {
  try {
    const { location, status, type, page = 1, limit = 50 } = req.query;

    const query = {
      isActive: true,
      isEnabled: true,
      deletedAt: { $exists: false },
    };

    if (location)
      query.location = { $regex: escapeRegex(location), $options: "i" };
    if (status) query.status = status;
    if (type) query.type = type;

    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(parseInt(limit) || 50, 100);
    const skip = (parsedPage - 1) * parsedLimit;

    const [spots, total] = await Promise.all([
      StationSpot.find(query)
        .populate("owner", "name username")
        .skip(skip)
        .limit(parsedLimit)
        .sort({ createdAt: -1 }),
      StationSpot.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: spots.length,
      total,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit),
      },
      spots,
    });
  } catch (error) {
    next(error);
  }
};

const getSpot = async (req, res, next) => {
  try {
    const spot = await StationSpot.findOne({
      _id: req.params.id,
      isActive: true,
      isEnabled: true,
      deletedAt: { $exists: false },
    }).populate("owner", "name email username");

    if (!spot) {
      return res.status(404).json({
        success: false,
        message: "Station spot not found",
      });
    }

    res.json({ success: true, spot });
  } catch (error) {
    next(error);
  }
};

// ==================== OWNER/ADMIN: FACILITY MANAGEMENT ====================

const createSpot = async (req, res, next) => {
  try {
    const {
      spotNumber,
      location,
      zone,
      type,
      hourlyRate,
      amenities,
      description,
    } = req.body;

    if (!spotNumber || !location || !hourlyRate) {
      return res.status(400).json({
        success: false,
        message: "spotNumber, location, and hourlyRate are required",
      });
    }

    // Prevent duplicate spot numbers per owner
    const exists = await StationSpot.findOne({
      spotNumber,
      owner: req.user.id,
      deletedAt: { $exists: false },
    });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Spot number already exists for your account",
      });
    }

    const newSpot = await StationSpot.create({
      spotNumber,
      location,
      zone: zone || "standard",
      type: type || "ev",
      hourlyRate,
      amenities: amenities || [],
      description: description || "",
      owner: req.user.id,
      status: "available",
      isActive: true,
      isEnabled: true,
    });

    // 🔔 Real-time sync to admin & owner dashboards
    const io = req.app.locals.io;
    if (io) {
      const payload = {
        id: newSpot._id,
        spotNumber: newSpot.spotNumber,
        location: newSpot.location,
        hourlyRate: newSpot.hourlyRate,
        status: newSpot.status,
        ownerId: req.user.id,
        timestamp: new Date().toISOString(),
      };
      io.to("admin:global").emit("spot:created", payload);
      io.to(`owner:${req.user.id}`).emit("spot:created", payload);
    }

    // 📝 Audit log
    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        action: "spot_created",
        details: `New facility created: ${newSpot.spotNumber} at ${newSpot.location}`,
        newValue: newSpot,
        isCritical: false,
      });
    }

    res.status(201).json({ success: true, spot: newSpot });
  } catch (error) {
    next(error);
  }
};

const getTopPerformingLocations = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    const matchStage = {
      isActive: true,
      isEnabled: true,
      deletedAt: { $exists: false },
    };

    // 🔒 Role-based data isolation
    if (req.user.role === "owner") {
      matchStage.owner = new mongoose.Types.ObjectId(req.user.id);
    }

    const topLocations = await StationSpot.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "bookings",
          localField: "_id",
          foreignField: "spot",
          as: "bookings",
        },
      },
      {
        $addFields: {
          recentBookings: {
            $filter: {
              input: "$bookings",
              as: "b",
              cond: {
                $and: [
                  { $eq: ["$$b.status", "completed"] },
                  { $gte: ["$$b.completedAt", dateThreshold] },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          totalBookings: { $size: "$recentBookings" },
          totalRevenue: {
            $sum: {
              $map: {
                input: "$recentBookings",
                as: "b",
                in: "$$b.totalCost",
              },
            },
          },
        },
      },
      { $sort: { totalBookings: -1, totalRevenue: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          spotNumber: 1,
          location: 1,
          zone: 1,
          hourlyRate: 1,
          totalBookings: 1,
          totalRevenue: 1,
          owner: 1,
        },
      },
    ]);

    res.json({ success: true, topLocations, periodDays: days });
  } catch (error) {
    next(error);
  }
};

// ==================== PROTECTED BOOKING ROUTES ====================

const createBooking = async (req, res, next) => {
  try {
    const { spotId, startTime, endTime, vehicle } = req.body;

    if (!spotId || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "spotId, startTime and endTime are required",
      });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid date format" });
    }
    if (end <= start) {
      return res
        .status(400)
        .json({ success: false, message: "End time must be after start time" });
    }
    if (start < new Date()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Cannot book a time slot in the past",
        });
    }

    const spot = await StationSpot.findById(spotId);
    if (!spot)
      return res
        .status(404)
        .json({ success: false, message: "Station spot not found" });
    if (spot.deletedAt)
      return res
        .status(400)
        .json({
          success: false,
          message: "This station spot is no longer available",
        });
    if (!spot.isEnabled)
      return res
        .status(400)
        .json({
          success: false,
          message: "This station is currently unavailable",
        });
    if (spot.status !== "available")
      return res
        .status(400)
        .json({
          success: false,
          message: "This station spot is currently not available",
        });

    const hours = (end - start) / (1000 * 60 * 60);
    const totalCost = Math.ceil(hours) * spot.hourlyRate;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const booking = await Booking.create(
        [
          {
            spot: spotId,
            user: req.user.id,
            startTime: start,
            endTime: end,
            totalCost,
            vehicle,
            status: "pending",
            paymentStatus: "pending",
          },
        ],
        { session },
      );

      await StationSpot.findByIdAndUpdate(
        spotId,
        { status: "reserved" },
        { session },
      );
      await session.commitTransaction();

      // 📝 Audit log
      const emitAuditLog = req.app.locals.emitAuditLog;
      if (emitAuditLog) {
        emitAuditLog({
          user: req.user.id,
          userName: req.user.name,
          userRole: req.user.role,
          action: "booking_created",
          details: `New booking created for spot ${spot.spotNumber}`,
          newValue: booking[0],
          isCritical: false,
        });
      }

      // 🔔 Real-time sync
      const io = req.app.locals.io;
      if (io) {
        io.to("admin:global").emit("booking:created", {
          id: booking[0]._id,
          spotId,
          userId: req.user.id,
        });
        io.to(`owner:${spot.owner}`).emit("booking:created", {
          id: booking[0]._id,
          spotId,
          userId: req.user.id,
        });
      }

      // 🔔 Notification service
      const notificationService = req.app.locals.notificationService;
      if (notificationService) {
        notificationService.sendBookingNotification({
          type: "bookingCreated",
          bookingId: booking[0]._id,
          userId: req.user.id,
          ownerId: spot.owner,
          spotNumber: spot.spotNumber,
          message: `New booking for spot ${spot.spotNumber}`,
        });
      }

      res
        .status(201)
        .json({
          success: true,
          message: "Booking created successfully",
          booking: booking[0],
        });
    } catch (txError) {
      await session.abortTransaction();
      throw txError;
    } finally {
      session.endSession();
    }
  } catch (error) {
    next(error);
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      Booking.find({ user: req.user.id })
        .populate("spot", "spotNumber location zone hourlyRate type")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Booking.countDocuments({ user: req.user.id }),
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

const completeBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user.id,
    }).populate("spot");
    if (!booking)
      return res
        .status(404)
        .json({
          success: false,
          message: "Booking not found or not authorized",
        });
    if (!["pending", "active"].includes(booking.status)) {
      return res
        .status(400)
        .json({ success: false, message: "This booking cannot be completed" });
    }

    booking.status = "completed";
    booking.paymentStatus = "paid";
    booking.completedAt = new Date();
    await booking.save();

    await StationSpot.findByIdAndUpdate(booking.spot, {
      status: "available",
      occupiedSince: null,
    });

    // 🔔 Real-time sync
    const io = req.app.locals.io;
    if (io) {
      io.to("admin:global").emit("booking:completed", {
        id: booking._id,
        spotId: booking.spot._id,
      });
      if (booking.spot?.owner)
        io.to(`owner:${booking.spot.owner}`).emit("booking:completed", {
          id: booking._id,
          spotId: booking.spot._id,
        });
    }

    const notificationService = req.app.locals.notificationService;
    if (notificationService) {
      notificationService.sendBookingNotification({
        type: "bookingCompleted",
        bookingId: booking._id,
        userId: req.user.id,
        message: "Your booking has been completed successfully",
      });
    }

    res.json({
      success: true,
      message: "Booking completed successfully",
      booking,
    });
  } catch (error) {
    next(error);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user.id,
    }).populate("spot");
    if (!booking)
      return res
        .status(404)
        .json({
          success: false,
          message: "Booking not found or not authorized",
        });
    if (!["pending", "active"].includes(booking.status)) {
      return res
        .status(400)
        .json({ success: false, message: "This booking cannot be cancelled" });
    }

    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason || "Cancelled by user";
    await booking.save();

    await StationSpot.findByIdAndUpdate(booking.spot, { status: "available" });

    // 🔔 Real-time sync
    const io = req.app.locals.io;
    if (io) {
      io.to("admin:global").emit("booking:cancelled", {
        id: booking._id,
        spotId: booking.spot?._id,
      });
      if (booking.spot?.owner)
        io.to(`owner:${booking.spot.owner}`).emit("booking:cancelled", {
          id: booking._id,
          spotId: booking.spot?._id,
        });
    }

    const notificationService = req.app.locals.notificationService;
    if (notificationService) {
      notificationService.sendBookingNotification({
        type: "bookingCancelled",
        bookingId: booking._id,
        userId: req.user.id,
        ownerId: booking.spot?.owner,
        message: `Booking for spot ${booking.spot?.spotNumber} was cancelled`,
      });
    }

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        action: "booking_cancelled",
        details: `Booking ${booking._id} cancelled — reason: ${booking.cancellationReason}`,
        isCritical: false,
      });
    }

    res.json({
      success: true,
      message: "Booking cancelled successfully",
      booking,
    });
  } catch (error) {
    next(error);
  }
};

// ====================== EXPORT ALL CONTROLLERS ======================
module.exports = {
  getSpots,
  getSpot,
  createSpot,
  getTopPerformingLocations,
  createBooking,
  getMyBookings,
  completeBooking,
  cancelBooking,
};
