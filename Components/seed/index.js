// backend/src/seed/index.js
// Standalone database seeder

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const connectDB = require("../config/db.js");
const { seedDatabase } = require("./seedUsers.js");
const logger = require("../config/logger.js");

dotenv.config();

const runSeed = async () => {
  try {
    logger.info("🚀 Starting standalone database seeder...");

    await connectDB();
    await seedDatabase();

    logger.info("🌱 Seeding completed successfully! 🎉");
  } catch (error) {
    logger.error("❌ Seeding error:", { error: error.message });
    process.exit(1);
  }

  // Graceful shutdown
  try {
    await mongoose.connection.close();
    logger.info("🔌 MongoDB connection closed");
  } catch (err) {
    logger.warn("⚠️ Error while closing MongoDB connection", {
      error: err.message,
    });
  }

  process.exit(0);
};

runSeed();
