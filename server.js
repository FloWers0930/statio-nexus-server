// backend/server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const connectDB = require("./Components/config/db");
const NotificationService = require("./Components/services/notificationService");
const logger = require("./Components/config/logger");
const { initSentry } = require("./Components/config/sentry");
const loggerMiddleware = require("./Components/middlewares/requestLogger");
const { apiLimiter } = require("./Components/middlewares/rateLimiter");
const errorHandler = require("./Components/middlewares/errorHandler");
const Audit = require("./Components/modules/audit/audit.model");

// ── Route Imports with Debug Logging ──────────────────────────────────────────
const authRoutes = require("./Components/modules/auth/auth.routes");
console.log(
  "🔍 authRoutes loaded:",
  typeof authRoutes,
  authRoutes ? "✅" : "❌",
);

const ownerRoutes = require("./Components/modules/owner/owner.routes");
console.log(
  "🔍 ownerRoutes loaded:",
  typeof ownerRoutes,
  ownerRoutes ? "✅" : "❌",
);

const stationRoutes = require("./Components/modules/station/station.routes");
console.log(
  "🔍 stationRoutes loaded:",
  typeof stationRoutes,
  stationRoutes ? "✅" : "❌",
);

const { seedDatabase } = require("./Components/seed/seedUsers");

const adminRoutes = require("./Components/modules/admin/admin.routes");
console.log(
  "🔍 adminRoutes loaded:",
  typeof adminRoutes,
  adminRoutes ? "✅" : "❌",
);

const analyticsRoutes = require("./Components/modules/analytics/analytics.routes");
console.log(
  "🔍 analyticsRoutes loaded:",
  typeof analyticsRoutes,
  analyticsRoutes ? "✅" : "❌",
);

const supportRoutes = require("./Components/modules/support/support.routes");
console.log(
  "🔍 supportRoutes loaded:",
  typeof supportRoutes,
  supportRoutes ? "✅" : "❌",
);

const auditRoutes = require("./Components/modules/audit/audit.routes");
console.log(
  "🔍 auditRoutes loaded:",
  typeof auditRoutes,
  auditRoutes ? "✅" : "❌",
);

const transactionRoutes = require("./Components/modules/transaction/transactionRoutes");
console.log(
  "🔍 transactionRoutes loaded:",
  typeof transactionRoutes,
  transactionRoutes ? "✅" : "❌",
);

const sentry = initSentry();
const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === "production";

// 👇 UPDATED: Added .filter(Boolean) to prevent empty strings from breaking CORS if .env has trailing commas
const allowedOrigins =
  process.env.ALLOWED_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean) ??
  (isProduction ? [] : ["http://localhost:5173", "http://localhost:5174"]);

// 👇 UPDATED: Completely overhauled to fix 500 preflight errors
const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // 2. DEVELOPMENT FIX: Automatically allow ALL localhost/127.0.0.1 variants and ports
    // This prevents 500 errors caused by Vite changing ports or using 127.0.0.1
    if (
      !isProduction &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    // 3. Check against the explicit allowedOrigins list (for production)
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // 4. FIX THE 500 ERROR:
    // Previously, `callback(new Error(...))` crashed the request and returned a 500.
    // Using `callback(null, false)` tells the cors package to simply block it without crashing.
    logger.warn(`❌ CORS blocked request from origin: ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],

  // 👇 UPDATED: REMOVED the strict `allowedHeaders` array!
  // If Axios sends an extra header (like 'Accept' or 'X-Requested-With'),
  // a strict array causes the preflight to crash with a 500 error.
  // Omitting it allows the cors package to automatically reflect the requested headers.
};

app.disable("x-powered-by");
app.set("trust proxy", 1);

// ── CORS preflight must be before helmet ─────────────────────────────────────
app.options("*", cors(corsOptions));

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", ...allowedOrigins],
      },
    },
  }),
);
app.use(compression());
app.use(mongoSanitize());
app.use(cors(corsOptions));
app.use(loggerMiddleware);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use("/api", apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
console.log("📝 Registering routes...");
app.use("/api/auth", authRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/station", stationRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/transactions", transactionRoutes);
console.log("✅ All routes registered successfully");

app.get("/api/health", (_req, res) =>
  res.json({ success: true, status: "OK" }),
);

// ── 404 Handler with Debug Logging ────────────────────────────────────────────
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorHandler);

if (sentry) {
  app.use(require("@sentry/node").Handlers.errorHandler());
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

const activeConnections = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication required"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    socket.tokenExpiry = decoded.exp * 1000;

    const userSockets = activeConnections.get(socket.userId) || new Set();
    if (userSockets.size >= 5) {
      return next(new Error("Too many active connections"));
    }
    userSockets.add(socket.id);
    activeConnections.set(socket.userId, userSockets);

    next();
  } catch (error) {
    next(new Error("Invalid authentication token"));
  }
});

io.on("connection", (socket) => {
  logger.info(`🔌 Socket connected: ${socket.id}`, {
    userId: socket.userId,
    role: socket.userRole,
  });

  const timeUntilExpiry = socket.tokenExpiry - Date.now();
  if (timeUntilExpiry > 0) {
    setTimeout(() => {
      socket.emit("auth_expiry_warning", { message: "Token expiring soon" });
    }, Math.max(0, timeUntilExpiry - 120000));
  }

  socket.on("update_token", (newToken) => {
    try {
      const decoded = jwt.verify(newToken, process.env.JWT_SECRET);
      if (decoded.id !== socket.userId) {
        socket.emit("error", { message: "Token user mismatch" });
        return;
      }
      socket.tokenExpiry = decoded.exp * 1000;
      socket.emit("token_updated", { success: true });
    } catch {
      socket.emit("error", { message: "Invalid token update" });
    }
  });

  socket.on("join", (room) => {
    if (
      typeof room !== "string" ||
      !/^(public|user|owner|admin):[a-zA-Z0-9_-]{3,50}$/.test(room)
    ) {
      logger.warn("Invalid room format", { socketId: socket.id, room });
      socket.emit("error", { message: "Invalid room format" });
      return;
    }

    if (!validateRoomAccess(socket, room)) {
      logger.warn("Unauthorized room join", {
        socketId: socket.id,
        room,
        userId: socket.userId,
      });
      socket.emit("error", { message: "Unauthorized to join this room" });
      return;
    }

    socket.join(room);
    logger.info(`📍 Socket joined room: ${room}`, { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    const userSockets = activeConnections.get(socket.userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) activeConnections.delete(socket.userId);
    }
    logger.info(`❌ Socket disconnected: ${socket.id}`);
  });
});

const validateRoomAccess = (socket, room) => {
  const [prefix, targetId] = room.split(":");
  switch (prefix) {
    case "public":
      return true;
    case "user":
      return socket.userId === targetId;
    case "owner":
      return (
        socket.userRole === "admin" ||
        (socket.userRole === "owner" && socket.userId === targetId)
      );
    case "admin":
      return socket.userRole === "admin";
    default:
      return false;
  }
};

const PORT = process.env.PORT || 5000;

const validateEnvironment = () => {
  const requiredVars = [
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "MONGO_URI",
    "BESU_RPC_URL",
    "SERVER_WALLET_PRIVATE_KEY",
    "CONTRACT_ADDRESS",
  ];

  if (isProduction) requiredVars.push("ALLOWED_ORIGINS");

  const optionalButImportant = [
    "STRIPE_SECRET_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error(
      `❌ Missing required environment variables: ${missing.join(", ")}`,
    );
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (process.env.JWT_SECRET.length < 32) {
    logger.error(
      "❌ JWT_SECRET must be at least 32 characters long for security",
    );
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  if (process.env.JWT_REFRESH_SECRET.length < 32) {
    logger.error(
      "❌ JWT_REFRESH_SECRET must be at least 32 characters long for security",
    );
    throw new Error("JWT_REFRESH_SECRET must be at least 32 characters long");
  }

  if (isProduction && allowedOrigins.some((o) => o.includes("localhost"))) {
    logger.warn(
      "⚠️ ALLOWED_ORIGINS contains localhost entries in production — this is a security risk",
    );
  }

  const missingOptional = optionalButImportant.filter((v) => !process.env[v]);
  if (missingOptional.length > 0) {
    logger.warn(
      `⚠️ Optional environment variables missing: ${missingOptional.join(
        ", ",
      )}. Some features may not work.`,
    );
  }

  logger.info("✅ All required environment variables validated");
};

const start = async () => {
  validateEnvironment();
  await connectDB();

  if (!isProduction) {
    await seedDatabase();
  }

  const notificationService = new NotificationService(io);

  const emitAuditLog = async (entry = {}) => {
    try {
      if (!entry.user || !entry.action || !entry.details) return;

      const audit = await Audit.create({
        user: entry.user,
        userName: entry.userName || "Unknown",
        userRole: entry.userRole || "user",
        action: entry.action,
        details: entry.details,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        isCritical: !!entry.isCritical,
      });

      notificationService.sendAuditNotification({
        id: audit._id,
        action: audit.action,
        details: audit.details,
        userRole: audit.userRole,
        isCritical: audit.isCritical,
        createdAt: audit.createdAt,
      });
    } catch (error) {
      logger.warn(`⚠️ Failed to write audit log: ${error.message}`);
    }
  };

  app.locals.notificationService = notificationService;
  app.locals.emitAuditLog = emitAuditLog;
  app.locals.io = io;

  server.listen(PORT, () => {
    logger.info(
      `🚀 Server running on port ${PORT} in ${
        process.env.NODE_ENV || "development"
      } mode`,
    );
    logger.info(`🌐 Allowed origins: ${allowedOrigins.join(", ") || "none"}`);
  });
};

start().catch((err) => {
  logger.error(`❌ Failed to start: ${err.message}`);
  process.exit(1);
});

const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
