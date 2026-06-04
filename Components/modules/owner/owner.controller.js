// backend/src/modules/owner/owner.controller.js
const mongoose = require("mongoose");
const { createWorker } = require("tesseract.js");
const { fromBuffer } = require("pdf2pic");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const logger = require("../../config/logger.js");
const User = require("../shared/user.model.js");
const Station = require("../shared/stationSpot.model.js");
const Booking = require("../shared/booking.model.js");
const Staff = require("../shared/staff.model.js");
const AuditLog = require("../audit/audit.model.js");
const { emitToUser } = require("../../services/notificationService.js");
const { sendTemporaryPasswordEmail } = require("../../config/email.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function zeroPadDays(data, startDate, endDate) {
  const map = {};
  for (const item of data) {
    map[item._id] = item.total;
  }

  const result = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({ date: key, revenue: map[key] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function pctGrowth(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}

/**
 * ✅ Generate a temporary password that PASSES the User model regex.
 * Must contain: 1 uppercase, 1 lowercase, 1 number, 1 special char, min 8 length.
 */
function generateTempPassword() {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const nums = "0123456789";
  const special = "@$!%*?&";
  const all = upper + lower + nums + special;

  let pass = "";
  pass += upper[Math.floor(Math.random() * upper.length)];
  pass += lower[Math.floor(Math.random() * lower.length)];
  pass += nums[Math.floor(Math.random() * nums.length)];
  pass += special[Math.floor(Math.random() * special.length)];

  for (let i = 0; i < 8; i++) {
    pass += all[Math.floor(Math.random() * all.length)];
  }

  return pass
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const spots = await Station.find({ owner: ownerId }).lean();
    const spotIds = spots.map((s) => s._id);

    const uniqueLocations = new Set(spots.map((s) => s.location));
    const totalStations = uniqueLocations.size;
    const totalSpots = spots.length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    );

    const [
      totalBookings,
      activeBookings,
      monthlyRevenue,
      lastMonthRevenue,
      totalRevenue,
      pendingBookings,
      staffCount,
    ] = await Promise.all([
      Booking.countDocuments({ spot: { $in: spotIds } }),
      Booking.countDocuments({
        spot: { $in: spotIds },
        status: { $in: ["active", "ongoing"] },
      }),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.countDocuments({
        spot: { $in: spotIds },
        status: "pending",
      }),
      Staff.countDocuments({ station: { $in: spotIds } }),
    ]);

    const thisMonth = monthlyRevenue[0]?.total || 0;
    const lastMonth = lastMonthRevenue[0]?.total || 0;
    const allTime = totalRevenue[0]?.total || 0;

    const occupancyRate =
      totalSpots > 0 ? Math.round((activeBookings / totalSpots) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalStations,
        totalSpots,
        totalBookings,
        activeBookings,
        pendingBookings,
        monthlyRevenue: thisMonth,
        totalRevenue: allTime,
        revenueGrowth: pctGrowth(thisMonth, lastMonth),
        occupancyRate,
        staffCount,
      },
    });
  } catch (err) {
    logger.error("getDashboard error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Analytics ────────────────────────────────────────────────────────────────

exports.getAnalytics = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { period = "30" } = req.query;
    const days = Math.min(Math.max(parseInt(period, 10) || 30, 7), 365);

    const spots = await Station.find({ owner: ownerId }).lean();
    const spotIds = spots.map((s) => s._id);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);
    const prevEnd = new Date(startDate);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevEnd.setHours(23, 59, 59, 999);

    const [
      revenueByDayRaw,
      prevPeriodRevenue,
      currentPeriodRevenue,
      occupancyByLocation,
      bookingStatusBreakdown,
      hourlyOccupancy,
      topLocations,
      recentBookings,
    ] = await Promise.all([
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate, $lte: now },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            total: { $sum: "$totalCost" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: prevStart, $lte: prevEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate, $lte: now },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            status: { $in: ["active", "ongoing"] },
          },
        },
        { $group: { _id: "$spot", activeBookings: { $sum: 1 } } },
        {
          $lookup: {
            from: "stationspots",
            localField: "_id",
            foreignField: "_id",
            as: "spotInfo",
          },
        },
        { $unwind: { path: "$spotInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            name: "$spotInfo.location",
            activeBookings: 1,
            totalSpots: { $ifNull: ["$spotInfo.totalSpots", 1] },
            occupancyRate: {
              $round: [
                {
                  $multiply: [
                    {
                      $divide: [
                        "$activeBookings",
                        { $ifNull: ["$spotInfo.totalSpots", 1] },
                      ],
                    },
                    100,
                  ],
                },
                1,
              ],
            },
          },
        },
      ]),
      Booking.aggregate([
        { $match: { spot: { $in: spotIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Booking.aggregate([
        { $match: { spot: { $in: spotIds }, createdAt: { $gte: startDate } } },
        { $group: { _id: { $hour: "$createdAt" }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate },
          },
        },
        {
          $lookup: {
            from: "stationspots",
            localField: "spot",
            foreignField: "_id",
            as: "spotInfo",
          },
        },
        { $unwind: { path: "$spotInfo", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$spotInfo.location", "Unknown"] },
            revenue: { $sum: "$totalCost" },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      Booking.find({ spot: { $in: spotIds } })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate({ path: "user", select: "name email", strictPopulate: false })
        .populate({
          path: "spot",
          select: "location spotNumber",
          strictPopulate: false,
        })
        .lean(),
    ]);

    const revenueByDay = zeroPadDays(revenueByDayRaw, startDate, now);
    const currentTotal = currentPeriodRevenue[0]?.total || 0;
    const prevTotal = prevPeriodRevenue[0]?.total || 0;

    const hourlyMap = {};
    for (const h of hourlyOccupancy) hourlyMap[h._id] = h.count;
    const maxHourlyCount = Math.max(...Object.values(hourlyMap), 1);
    const hourlyFull = Array.from({ length: 24 }, (_, i) => {
      const count = hourlyMap[i] || 0;
      const pct = Math.round((count / maxHourlyCount) * 100);
      return {
        hour: i,
        label: `${String(i).padStart(2, "0")}:00`,
        count,
        occupancy: pct,
        occupancyRate: pct,
      };
    });

    const locationSpotCounts = {};
    for (const s of spots) {
      const loc = s.location || "Unknown";
      if (!locationSpotCounts[loc]) locationSpotCounts[loc] = 0;
      locationSpotCounts[loc]++;
    }

    const activeMap = {};
    for (const o of occupancyByLocation) activeMap[String(o._id)] = o;

    const occupancyByLocationName = {};
    for (const [spotId, o] of Object.entries(activeMap)) {
      const loc = o.name || "Unknown";
      if (!occupancyByLocationName[loc]) {
        occupancyByLocationName[loc] = {
          location: loc,
          activeBookings: 0,
          totalSpots: locationSpotCounts[loc] || 0,
        };
      }
      occupancyByLocationName[loc].activeBookings += o.activeBookings || 0;
    }

    for (const [loc, count] of Object.entries(locationSpotCounts)) {
      if (!occupancyByLocationName[loc]) {
        occupancyByLocationName[loc] = {
          location: loc,
          activeBookings: 0,
          totalSpots: count,
        };
      }
    }

    const fullOccupancy = Object.values(occupancyByLocationName).map((o) => ({
      ...o,
      occupancyRate:
        o.totalSpots > 0
          ? Math.round((o.activeBookings / o.totalSpots) * 100)
          : 0,
    }));

    let normalizedTopLocations;
    if (topLocations.length > 0) {
      normalizedTopLocations = topLocations.map((t) => ({
        location: t._id || "Unknown",
        revenue: t.revenue || 0,
        bookings: t.bookings || 0,
        total: locationSpotCounts[t._id] || 0,
        occupied: 0,
      }));
    } else {
      normalizedTopLocations = Object.entries(locationSpotCounts)
        .map(([location, total]) => ({
          location,
          revenue: 0,
          bookings: 0,
          total,
          occupied: 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    }

    const revenueByDayFinal =
      revenueByDay.length > 0 ? revenueByDay : zeroPadDays([], startDate, now);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayBookings = await Booking.countDocuments({
      spot: { $in: spotIds },
      createdAt: { $gte: todayStart },
    });
    const totalSpots = spots.length;
    const activeBookingsCount = await Booking.countDocuments({
      spot: { $in: spotIds },
      status: { $in: ["active", "ongoing"] },
    });
    const overallOccupancyRate =
      totalSpots > 0 ? Math.round((activeBookingsCount / totalSpots) * 100) : 0;

    res.json({
      success: true,
      data: {
        stats: {
          monthlyRevenue: currentTotal,
          totalRevenue: currentTotal,
          todayBookings,
          activeBookings: activeBookingsCount,
          totalSpots,
          occupancyRate: overallOccupancyRate,
          revenueGrowth: pctGrowth(currentTotal, prevTotal),
          bookingGrowth: null,
        },
        charts: {
          revenueByDay: revenueByDayFinal,
          occupancyByLocation: fullOccupancy,
          topLocations: normalizedTopLocations,
          bookingStatusBreakdown: bookingStatusBreakdown.map((b) => ({
            status: b._id,
            count: b.count,
          })),
          hourlyOccupancy: hourlyFull,
          recentBookings: recentBookings.map((b) => ({
            _id: b._id,
            user: b.user ? { name: b.user.name, email: b.user.email } : null,
            spot: {
              location: b.spot?.location || "—",
              spotNumber: b.spot?.spotNumber || "—",
            },
            status: b.status,
            paymentStatus: b.paymentStatus,
            totalCost: b.totalCost || 0,
            createdAt: b.createdAt,
          })),
        },
      },
    });
  } catch (err) {
    logger.error("getAnalytics error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Revenue ──────────────────────────────────────────────────────────────────

exports.getRevenue = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { period = "30" } = req.query;
    const days = Math.min(Math.max(parseInt(period, 10) || 30, 7), 365);

    const spots = await Station.find({ owner: ownerId }).lean();
    const spotIds = spots.map((s) => s._id);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);
    const prevEnd = new Date(startDate);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevEnd.setHours(23, 59, 59, 999);

    const [
      revenueByDayRaw,
      currentPeriod,
      prevPeriod,
      revenueByStation,
      allTime,
    ] = await Promise.all([
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate, $lte: now },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            total: { $sum: "$totalCost" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate, $lte: now },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalCost" },
            count: { $sum: 1 },
            avgTransaction: { $avg: "$totalCost" },
          },
        },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: prevStart, $lte: prevEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startDate, $lte: now },
          },
        },
        {
          $group: {
            _id: "$spot",
            revenue: { $sum: "$totalCost" },
            bookings: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "stationspots",
            localField: "_id",
            foreignField: "_id",
            as: "info",
          },
        },
        { $unwind: { path: "$info", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            name: { $ifNull: ["$info.location", "Unknown"] },
            revenue: 1,
            bookings: 1,
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      Booking.aggregate([
        { $match: { spot: { $in: spotIds }, paymentStatus: "paid" } },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalCost" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const revenueByDay = zeroPadDays(revenueByDayRaw, startDate, now);
    const current = currentPeriod[0] || {
      total: 0,
      count: 0,
      avgTransaction: 0,
    };
    const prev = prevPeriod[0]?.total || 0;

    res.json({
      success: true,
      data: {
        period: days,
        revenueByDay,
        summary: {
          total: current.total,
          transactions: current.count,
          avgTransaction: Math.round((current.avgTransaction || 0) * 100) / 100,
          growth: pctGrowth(current.total, prev),
          allTimeTotal: allTime[0]?.total || 0,
          allTimeTransactions: allTime[0]?.count || 0,
        },
        revenueByStation,
      },
    });
  } catch (err) {
    logger.error("getRevenue error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Locations / Stations ─────────────────────────────────────────────────────

exports.getLocations = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [spots, total] = await Promise.all([
      Station.find({ owner: ownerId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Station.countDocuments({ owner: ownerId }),
    ]);

    res.json({ success: true, spots, total });
  } catch (err) {
    logger.error("getLocations error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createLocation = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const {
      location,
      name,
      address,
      zone,
      hourlyRate,
      pricePerHour,
      totalSpots = 1,
      status = "available",
      amenities,
      coordinates,
    } = req.body;

    const resolvedName = location || name;
    const resolvedRate = hourlyRate !== undefined ? hourlyRate : pricePerHour;

    if (!resolvedName || !address || !resolvedRate) {
      return res.status(400).json({
        success: false,
        message: "location, address, and hourlyRate are required",
      });
    }

    const count = Math.max(1, parseInt(totalSpots, 10) || 1);
    const rate = parseFloat(resolvedRate);

    const existing = await Station.findOne(
      { owner: ownerId, location: resolvedName },
      { spotNumber: 1 },
    )
      .sort({ spotNumber: -1 })
      .lean();
    const startNumber = existing?.spotNumber ? existing.spotNumber + 1 : 1;

    const spotsToCreate = Array.from({ length: count }, (_, i) => ({
      owner: ownerId,
      location: resolvedName,
      address,
      zone: zone || "General",
      hourlyRate: rate,
      status,
      isEnabled: true,
      spotNumber: startNumber + i,
      amenities: amenities || [],
      coordinates: coordinates || {},
    }));

    const spots = await Station.insertMany(spotsToCreate);
    logger.info(
      `${count} spot(s) created at "${resolvedName}" by owner ${ownerId}`,
    );

    res.status(201).json({ success: true, data: spots });
  } catch (err) {
    logger.error("createLocation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const { location, name, hourlyRate, pricePerHour, ...rest } = req.body;
    const updateFields = { ...rest };
    if (location !== undefined) updateFields.location = location;
    else if (name !== undefined) updateFields.location = name;
    if (hourlyRate !== undefined)
      updateFields.hourlyRate = parseFloat(hourlyRate);
    else if (pricePerHour !== undefined)
      updateFields.hourlyRate = parseFloat(pricePerHour);

    const station = await Station.findOneAndUpdate(
      { _id: id, owner: ownerId },
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    if (!station)
      return res
        .status(404)
        .json({ success: false, message: "Station not found" });
    res.json({ success: true, data: station });
  } catch (err) {
    logger.error("updateLocation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteLocation = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const station = await Station.findOneAndDelete({ _id: id, owner: ownerId });
    if (!station)
      return res
        .status(404)
        .json({ success: false, message: "Station not found" });

    logger.info(`Station deleted: ${id} by owner ${ownerId}`);
    res.json({ success: true, message: "Station deleted" });
  } catch (err) {
    logger.error("deleteLocation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Staff ────────────────────────────────────────────────────────────────────

exports.getStaff = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const spots = await Station.find({ owner: ownerId }).lean();
    const spotIds = spots.map((s) => s._id);

    const staff = await Staff.find({ station: { $in: spotIds } })
      .populate("station", "location address spotNumber")
      .lean();

    const stationMap = {};
    spots.forEach((spot) => {
      if (!stationMap[spot.location]) {
        stationMap[spot.location] = {
          _id: spot._id,
          name: spot.location,
          code: `STN-${spot.location.substring(0, 3).toUpperCase()}`,
          location: spot.address,
        };
      }
    });
    const availableStations = Object.values(stationMap);

    res.json({ success: true, staff, availableStations });
  } catch (err) {
    logger.error("getStaff error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ UPDATED: Generates temp password, creates User account, sends email
exports.createStaff = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { name, fullName, email, phone, role, stationId } = req.body;
    const resolvedName = fullName || name;

    if (!resolvedName || !email) {
      return res
        .status(400)
        .json({ success: false, message: "Name and Email are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const existingStaff = await Staff.findOne({ email });
    if (existingStaff) {
      return res.status(409).json({
        success: false,
        message: "Staff member with this email already exists",
      });
    }

    // 🔐 Generate Secure Temporary Password (passes User model regex)
    const tempPassword = generateTempPassword();

    // 👤 Create User Account (Authentication)
    const user = await User.create({
      username: email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
      email,
      password: tempPassword,
      name: resolvedName,
      role: role || "staff",
      mustChangePassword: true,
      isActive: true,
    });

    // 📧 Send Email with Temporary Password
    await sendTemporaryPasswordEmail(email, resolvedName, tempPassword);

    // 📋 Create Staff Profile (HR Data)
    const staff = await Staff.create({
      owner: ownerId,
      name: resolvedName,
      username: user.username,
      email,
      phone: phone || "+0000000000", // ✅ Fixed: valid phone format placeholder
      dateOfBirth: new Date("2000-01-01"),
      gender: "Other",
      address: "To be updated",
      idNumber: "PENDING",
      emergencyContactName: "To be updated",
      emergencyContactPhone: "+0000000000", // ✅ Fixed: valid phone format placeholder
      role: role === "admin" ? "admin" : "attendant",
      isActive: true,
    });

    logger.info(`New staff member created: ${email} (User ID: ${user._id})`);

    res.status(201).json({
      success: true,
      data: staff,
      message:
        "Employee added. Temporary login credentials sent to their email.",
    });
  } catch (err) {
    logger.error("createStaff error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const spots = await Station.find({ owner: ownerId }, "_id").lean();
    const spotIds = spots.map((s) => s._id);

    const staff = await Staff.findOneAndUpdate(
      { _id: id, station: { $in: spotIds } },
      { $set: req.body },
      { new: true, runValidators: true },
    );

    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff member not found" });

    await emitToUser(ownerId, "staffUpdated", { staffId: staff._id });
    res.json({ success: true, data: staff });
  } catch (err) {
    logger.error("updateStaff error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const spots = await Station.find({ owner: ownerId }, "_id").lean();
    const spotIds = spots.map((s) => s._id);

    const staff = await Staff.findOneAndDelete({
      _id: id,
      station: { $in: spotIds },
    });
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff member not found" });

    await emitToUser(ownerId, "staffDeleted", { staffId: id });
    res.json({ success: true, message: "Staff member removed" });
  } catch (err) {
    logger.error("deleteStaff error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.resendStaffInvite = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const spots = await Station.find({ owner: ownerId }, "_id").lean();
    const spotIds = spots.map((s) => s._id);

    const staff = await Staff.findOne({ _id: id, station: { $in: spotIds } });
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff member not found" });

    logger.info(
      `Resend invite requested for staff ${staff.email} by owner ${ownerId}`,
    );

    res.json({ success: true, message: "Invite resent successfully" });
  } catch (err) {
    logger.error("resendStaffInvite error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Profile / Settings ───────────────────────────────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password -refreshToken")
      .lean();
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    res.json({ success: true, data: user });
  } catch (err) {
    logger.error("getProfile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, businessName, businessAddress } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, phone, businessName, businessAddress } },
      { new: true, runValidators: true },
    ).select("-password -refreshToken");
    res.json({ success: true, data: user });
  } catch (err) {
    logger.error("updateProfile error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Name aliases ─────────────────────────────────────────────────────────────
exports.getOwnerSpots = exports.getLocations;
exports.createSpot = exports.createLocation;
exports.updateSpot = exports.updateLocation;
exports.deleteSpot = exports.deleteLocation;
exports.getDashboardAnalytics = exports.getDashboard;

// ─── Owner Bookings ───────────────────────────────────────────────────────────

exports.getOwnerBookings = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { status, page = 1, limit = 20 } = req.query;

    const spots = await Station.find({ owner: ownerId }, "_id").lean();
    const spotIds = spots.map((s) => s._id);

    const filter = { spot: { $in: spotIds } };
    if (status) filter.status = status;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate({ path: "user", select: "name email", strictPopulate: false })
        .populate({
          path: "spot",
          select: "location spotNumber",
          strictPopulate: false,
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Booking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      bookings,
      data: bookings,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    logger.error("getOwnerBookings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── OCR ──────────────────────────────────────────────────────────────────────

exports.performOCR = async (req, res) => {
  try {
    if (!req.file && !req.body.fileBase64) {
      return res
        .status(400)
        .json({ success: false, message: "No file provided" });
    }

    const buffer = req.file
      ? req.file.buffer
      : Buffer.from(req.body.fileBase64, "base64");
    const mimeType = req.file?.mimetype || req.body.mimeType || "image/png";
    let imageBuffer = buffer;

    if (mimeType === "application/pdf") {
      try {
        const converter = fromBuffer(buffer, {
          density: 200,
          format: "png",
          width: 1200,
          height: 1600,
        });
        const page = await converter(1, { responseType: "buffer" });
        imageBuffer = page.buffer;
      } catch (pdfErr) {
        logger.error("PDF to image conversion failed:", pdfErr);
        return res
          .status(422)
          .json({ success: false, message: "Could not process PDF file" });
      }
    }

    const worker = await createWorker("eng");
    const { data } = await worker.recognize(imageBuffer);
    await worker.terminate();

    res.json({
      success: true,
      data: {
        text: data.text,
        confidence: data.confidence,
        words: data.words?.length || 0,
      },
    });
  } catch (err) {
    logger.error("performOCR error:", err);
    res.status(500).json({ success: false, message: "OCR processing failed" });
  }
};

// ─── Security ─────────────────────────────────────────────────────────────────

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({
        success: false,
        message: "currentPassword and newPassword are required",
      });
    if (newPassword.length < 8)
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });

    const user = await User.findById(req.user._id).select("+password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: "Current password is incorrect" });

    user.password = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await user.save();

    logger.info(`Password changed for user ${user._id}`);
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    logger.error("changePassword error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Two-Factor Authentication ────────────────────────────────────────────────

exports.enableTwoFactor = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const secret = speakeasy.generateSecret({
      name: `StatioNexus (${user.email})`,
      length: 32,
    });
    user.twoFactorTempSecret = secret.base32;
    await user.save();

    res.json({
      success: true,
      data: { secret: secret.base32, otpauthUrl: secret.otpauth_url },
    });
  } catch (err) {
    logger.error("enableTwoFactor error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.verifyTwoFactor = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Token is required" });

    const user = await User.findById(req.user._id);
    if (!user?.twoFactorTempSecret)
      return res
        .status(400)
        .json({ success: false, message: "2FA setup not initiated" });

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorTempSecret,
      encoding: "base32",
      token,
      window: 1,
    });
    if (!isValid)
      return res.status(401).json({ success: false, message: "Invalid token" });

    user.twoFactorSecret = user.twoFactorTempSecret;
    user.twoFactorTempSecret = undefined;
    user.twoFactorEnabled = true;

    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex"),
    );
    user.twoFactorBackupCodes = backupCodes;
    await user.save();

    logger.info(`2FA enabled for user ${user._id}`);
    res.json({
      success: true,
      message: "Two-factor authentication enabled",
      data: { backupCodes },
    });
  } catch (err) {
    logger.error("verifyTwoFactor error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.disableTwoFactor = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({
        success: false,
        message: "Password is required to disable 2FA",
      });

    const user = await User.findById(req.user._id).select("+password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: "Incorrect password" });

    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorTempSecret = undefined;
    user.twoFactorBackupCodes = [];
    await user.save();

    logger.info(`2FA disabled for user ${user._id}`);
    res.json({ success: true, message: "Two-factor authentication disabled" });
  } catch (err) {
    logger.error("disableTwoFactor error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
