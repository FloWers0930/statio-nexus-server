// backend/src/seed/seedUsers.js
// Database seeding logic - creates admin, owner, and initial station spots

const User = require("../modules/shared/user.model.js");
const StationSpot = require("../modules/shared/stationSpot.model.js");
const logger = require("../config/logger.js");

const SEED_CONFIG = {
  admin: {
    username: "admin",
    name: "Administrator",
    email: "admin@statio-nexus.com",
    role: "admin",
  },
  owner: {
    username: "owner",
    name: "Owner User",
    email: "owner@statio-nexus.com",
    role: "owner",
  },
};

const seedAdmin = async () => {
  const seedPassword = process.env.ADMIN_SEED_PASS;
  if (!seedPassword) throw new Error("ADMIN_SEED_PASS required");

  let admin = await User.findOne({ role: "admin" }).select("+password");

  if (admin) {
    const isMatch = await admin.matchPassword(seedPassword);
    if (!isMatch) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Admin password mismatch in production");
      }
      admin.password = seedPassword;
      await admin.save();
      logger.info("🔄 Admin password reset");
    } else {
      logger.info("✅ Admin exists");
    }
    return admin;
  }

  admin = await User.create({
    ...SEED_CONFIG.admin,
    password: seedPassword,
    isActive: true,
  });
  logger.info("✅ Admin created");
  return admin;
};

const seedOwner = async () => {
  const seedPassword = process.env.OWNER_SEED_PASS;
  if (!seedPassword) throw new Error("OWNER_SEED_PASS required");

  let owner = await User.findOne({ role: "owner" }).select("+password");

  if (owner) {
    const isMatch = await owner.matchPassword(seedPassword);
    if (!isMatch) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Owner password mismatch in production");
      }
      owner.password = seedPassword;
      await owner.save();
      logger.info("🔄 Owner password reset");
    } else {
      logger.info("✅ Owner exists");
    }
    return owner;
  }

  owner = await User.create({
    ...SEED_CONFIG.owner,
    password: seedPassword,
    isActive: true,
  });
  logger.info("✅ Owner created");
  return owner;
};

const seedStationSpots = async (ownerId) => {
  if (!ownerId) throw new Error("Owner ID required");

  const count = await StationSpot.countDocuments();
  if (count > 0) {
    logger.info(`✅ ${count} station spots exist, skipping`);
    return;
  }

  const spots = [
    {
      spotNumber: "UV-001",
      location: "Crossroad Tandang Sora",
      zone: "Transport Terminal, UV Express",
      type: "transport",
      status: "available",
      hourlyRate: 20.0,
      owner: ownerId,
    },
    {
      spotNumber: "UV-002",
      location: "Crossroad Tandang Sora",
      zone: "Transport Terminal, UV Express",
      type: "transport",
      status: "available",
      hourlyRate: 20.0,
      owner: ownerId,
    },
    {
      spotNumber: "JEEP-001",
      location: "Crossroad Tandang Sora",
      zone: "Transport Terminal, Jeepney",
      type: "transport",
      status: "available",
      hourlyRate: 25.0,
      owner: ownerId,
    },
    {
      spotNumber: "JEEP-002",
      location: "Crossroad Tandang Sora",
      zone: "Transport Terminal, Jeepney",
      type: "transport",
      status: "occupied",
      hourlyRate: 25.0,
      owner: ownerId,
    },
    {
      spotNumber: "TRI-001",
      location: "Crossroad Tandang Sora",
      zone: "Transport Terminal, Tricycle",
      type: "transport",
      status: "available",
      hourlyRate: 15.0,
      owner: ownerId,
    },
    {
      spotNumber: "HOTEL-001",
      location: "Crossroad Tandang Sora",
      zone: "Hotel, Guest Parking",
      type: "premium",
      status: "available",
      hourlyRate: 50.0,
      owner: ownerId,
    },
    {
      spotNumber: "HOTEL-002",
      location: "Crossroad Tandang Sora",
      zone: "Hotel, Guest Parking",
      type: "premium",
      status: "occupied",
      hourlyRate: 50.0,
      owner: ownerId,
    },
    {
      spotNumber: "COM-001",
      location: "Crossroad Tandang Sora",
      zone: "Commercial Area, Shop Level",
      type: "standard",
      status: "available",
      hourlyRate: 30.0,
      owner: ownerId,
    },
    {
      spotNumber: "COM-002",
      location: "Crossroad Tandang Sora",
      zone: "Commercial Area, Shop Level",
      type: "handicap",
      status: "available",
      hourlyRate: 15.0,
      owner: ownerId,
    },
  ];

  await StationSpot.insertMany(spots);
  logger.info(`✅ ${spots.length} station spots seeded`);
};

const seedDatabase = async () => {
  logger.info("🌱 Starting Statio Nexus database seeding...");

  try {
    const admin = await seedAdmin();
    const owner = await seedOwner();
    await seedStationSpots(owner._id);

    logger.info("✅ Database seeding completed");
    return { admin: admin._id, owner: owner._id };
  } catch (error) {
    logger.error("❌ Seeding failed", { error: error.message });
    throw error;
  }
};

module.exports = { seedDatabase, seedAdmin, seedOwner, seedStationSpots };

