// backend/src/modules/analytics/analytics.controller.js
const mongoose = require("mongoose");
const Booking = require("../shared/booking.model");
const StationSpot = require("../shared/stationSpot.model");

// Simple in-memory TTL cache for analytics
const analyticsCache = new Map();
const TTL_MS = Number(process.env.ANALYTICS_CACHE_TTL_MS) || 60 * 1000;

function getCached(key) {
  const cached = analyticsCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    analyticsCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(key, value) {
  analyticsCache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

// ✅ Get server timezone offset for consistent date handling between
// MongoDB $dateToString and Node.js date formatting
const getTimezoneOffset = () => {
  const offset = -new Date().getTimezoneOffset(); // minutes from UTC
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const mins = String(absOffset % 60).padStart(2, "0");
  return `${sign}${hours}:${mins}`;
};

const SERVER_TIMEZONE = getTimezoneOffset(); // e.g., "+08:00" or "-05:00"

// ✅ Format date using UTC-adjusted math to match MongoDB $dateToString with timezone
const formatDateStr = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper: Format hour for display
const formatHour = (hour) =>
  hour === 0
    ? "12AM"
    : hour < 12
    ? `${hour}AM`
    : hour === 12
    ? "12PM"
    : `${hour - 12}PM`;

// Helper: Generate 24-hour array with zero defaults
const generateEmptyHourly = () =>
  Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    occupancy: 0,
  }));

const getOwnerAnalytics = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const cacheKey = `ownerAnalytics:${ownerId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // ✅ Get all active (non-deleted) spots for this owner
    const spots = await StationSpot.find({
      owner: ownerId,
      deletedAt: { $exists: false },
    }).select("_id status location");

    const spotIds = spots.map((s) => s._id);

    // Empty state: no spots yet
    if (spotIds.length === 0) {
      const emptyResponse = {
        success: true,
        stats: {
          monthlyRevenue: 0,
          todayBookings: 0,
          activeBookings: 0,
          totalSpots: 0,
          occupancyRate: 0,
          revenueGrowth: null,
          bookingGrowth: null,
        },
        charts: {
          revenueByDay: [],
          occupancyByLocation: [],
          hourlyOccupancy: generateEmptyHourly(),
        },
      };
      setCached(cacheKey, emptyResponse);
      return res.json(emptyResponse);
    }

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfToday);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOf30Days = new Date(now);
    startOf30Days.setDate(now.getDate() - 29);
    startOf30Days.setHours(0, 0, 0, 0);

    // ✅ Run all analytics queries in parallel
    const [
      activeBookingsCount,
      todayBookingsCount,
      yesterdayBookingsCount,
      monthlyRevenueAgg,
      revenueByDayAgg,
      occupancyByLocationAgg,
      hourlyBookingsAgg,
      totalSpotsCount,
    ] = await Promise.all([
      // Active bookings right now
      Booking.countDocuments({
        spot: { $in: spotIds },
        status: "active",
      }),

      // Today's bookings (non-cancelled)
      Booking.countDocuments({
        spot: { $in: spotIds },
        status: { $ne: "cancelled" },
        createdAt: { $gte: startOfToday },
      }),

      // Yesterday's bookings for growth calculation
      Booking.countDocuments({
        spot: { $in: spotIds },
        status: { $ne: "cancelled" },
        createdAt: { $gte: startOfYesterday, $lt: endOfYesterday },
      }),

      // Monthly revenue (paid only)
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

      // ✅ Revenue by day (last 30 days) WITH explicit timezone
      // This is the ROOT CAUSE fix: without timezone, MongoDB uses UTC
      // which never matches Node.js local-time formatDateStr()
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            paymentStatus: "paid",
            createdAt: { $gte: startOf30Days },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: SERVER_TIMEZONE, // ✅ KEY FIX
              },
            },
            revenue: { $sum: "$totalCost" },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: "$_id",
            revenue: 1,
            bookings: 1,
          },
        },
      ]),

      // ✅ Occupancy by location WITH revenue (top 5 by revenue)
      StationSpot.aggregate([
        {
          $match: {
            owner: new mongoose.Types.ObjectId(ownerId),
            deletedAt: { $exists: false },
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$location", "Unknown"] },
            totalSpots: { $sum: 1 },
            occupiedSpots: {
              $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: "bookings",
            let: { location: "$_id" },
            pipeline: [
              {
                $lookup: {
                  from: "stationspots",
                  localField: "spot",
                  foreignField: "_id",
                  as: "spotRef",
                },
              },
              { $unwind: "$spotRef" },
              {
                $match: {
                  $expr: {
                    $eq: [
                      { $ifNull: ["$spotRef.location", "Unknown"] },
                      "$$location",
                    ],
                  },
                  "spotRef.owner": new mongoose.Types.ObjectId(ownerId),
                  "spotRef.deletedAt": { $exists: false },
                  paymentStatus: "paid",
                  createdAt: { $gte: startOfMonth },
                },
              },
            ],
            as: "paidBookings",
          },
        },
        {
          $project: {
            _id: 0,
            location: "$_id",
            total: "$totalSpots",
            occupied: "$occupiedSpots",
            revenue: { $sum: "$paidBookings.totalCost" },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),

      // Hourly bookings today (for occupancy heatmap)
      Booking.aggregate([
        {
          $match: {
            spot: { $in: spotIds },
            status: { $ne: "cancelled" },
            createdAt: { $gte: startOfToday },
          },
        },
        {
          $group: {
            _id: { $hour: "$createdAt" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Total spots count
      StationSpot.countDocuments({
        owner: ownerId,
        deletedAt: { $exists: false },
      }),
    ]);

    // ✅ Compute derived stats
    const monthlyRevenue = monthlyRevenueAgg[0]?.total || 0;
    const totalSpots = totalSpotsCount;
    const occupiedSpots = spots.filter((s) => s.status === "occupied").length;
    const occupancyRate =
      totalSpots > 0 ? Math.round((occupiedSpots / totalSpots) * 100) : 0;

    // Growth calculations
    const todayCount = todayBookingsCount || 0;
    const yesterdayCount = yesterdayBookingsCount || 0;
    const bookingGrowth =
      yesterdayCount > 0
        ? Number(
            (((todayCount - yesterdayCount) / yesterdayCount) * 100).toFixed(1),
          )
        : null;

    // ✅ Format hourly occupancy (24 hours, percentage based on max)
    const hourlyMap = {};
    hourlyBookingsAgg.forEach((h) => {
      hourlyMap[h._id] = h.count;
    });
    const maxHourly = Math.max(...Object.values(hourlyMap), 1);
    const hourlyOccupancy = Array.from({ length: 24 }, (_, hour) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      occupancy: hourlyMap[hour]
        ? Math.round((hourlyMap[hour] / maxHourly) * 100)
        : 0,
    }));

    // ✅ Fill all 30 days using consistent local date formatter
    // Now matches MongoDB output because both use SERVER_TIMEZONE
    const revenueMap = new Map(revenueByDayAgg.map((d) => [d.date, d]));
    const revenueByDay = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(startOf30Days);
      date.setDate(date.getDate() + i);
      const dateStr = formatDateStr(date);
      const existing = revenueMap.get(dateStr);
      revenueByDay.push({
        date: dateStr,
        revenue: existing?.revenue || 0,
        bookings: existing?.bookings || 0,
      });
    }

    // ✅ Build response matching frontend expectations
    const response = {
      success: true,
      stats: {
        monthlyRevenue,
        todayBookings: todayCount,
        activeBookings: activeBookingsCount || 0,
        totalSpots,
        occupancyRate,
        revenueGrowth: null,
        bookingGrowth,
      },
      charts: {
        revenueByDay,
        occupancyByLocation,
        hourlyOccupancy,
      },
    };

    // Cache and respond
    setCached(cacheKey, response);
    res.json(response);
  } catch (error) {
    // Clear cache on error to avoid stale bad data
    const cacheKey = `ownerAnalytics:${req.user.id}`;
    analyticsCache.delete(cacheKey);

    console.error("❌ Analytics error:", {
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
    next(error);
  }
};

// ✅ Helper: Invalidate cache when related data changes
const invalidateOwnerAnalyticsCache = (ownerId) => {
  const cacheKey = `ownerAnalytics:${ownerId}`;
  analyticsCache.delete(cacheKey);
};

module.exports = {
  getOwnerAnalytics,
  invalidateOwnerAnalyticsCache,
};
