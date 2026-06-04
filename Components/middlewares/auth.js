// backend/src/middlewares/auth.js
// Authentication & authorization middleware

const jwt = require("jsonwebtoken");
const User = require("../modules/shared/user.model.js");
const logger = require("../config/logger.js");

const Authenticate = async (req, res, next) => {
  try {
    let token;

    // Extract token from Bearer header
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token provided",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded.userId || decoded._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    // Fetch user (exclude sensitive fields)
    const user = await User.findById(userId).select("-password -__v");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is disabled. Contact admin.",
      });
    }

    // Attach clean user object to request
    req.user = {
      id: user._id.toString(),
      _id: user._id,
      role: user.role,
      email: user.email,
      username: user.username,
      name: user.name,
      mustChangePassword: user.mustChangePassword, // ✅ Added for password enforcement
    };

    next();
  } catch (error) {
    logger.error("Auth middleware error:", {
      error: error.message,
      name: error.name,
      path: req.path,
    });

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired, please login again",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    res.status(401).json({
      success: false,
      message: "Not authorized, token failed",
    });
  }
};

// Role-based authorization middleware
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn("Authorization denied", {
        path: req.path,
        requiredRoles: roles,
        actualRole: req.user?.role,
        userId: req.user?.id,
      });

      return res.status(403).json({
        success: false,
        message: `Access denied. Only ${roles.join(
          ", ",
        )} can perform this action.`,
      });
    }

    next();
  };
};

// ✅ NEW: Enforce password change for first-time users
const requirePasswordChange = (req, res, next) => {
  if (!req.user) return next();

  if (req.user.mustChangePassword) {
    // Allow ONLY these critical routes
    const allowedPaths = ["/change-password", "/me", "/profile", "/logout"];

    // Check if current request matches an allowed route
    const isAllowed = allowedPaths.some(
      (path) => req.path.includes(path) || req.originalUrl.includes(path),
    );

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "Password change required before accessing this resource.",
        mustChangePassword: true, // 🔑 Flag for frontend to redirect
      });
    }
  }

  next();
};

module.exports = {
  Authenticate,
  restrictTo,
  requirePasswordChange, // ✅ Export new middleware
};
