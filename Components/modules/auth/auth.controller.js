// Authentication controller - login, refresh token, password change, profile

const User = require("../shared/user.model.js");
const jwt = require("jsonwebtoken");
const logger = require("../../config/logger.js");
const tokenBlacklist = require("../../services/tokenBlacklistService.js");

// ─── Secure cookie options for refresh token ──────────────────────────────────
const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/auth/refresh", // 🔒 Only sent to refresh endpoint
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ─── Password complexity regex (matches user.model.js validation) ─────────────
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// ─── Token generators ─────────────────────────────────────────────────────────
const generateToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });

const generateRefreshToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });

const createAuthTokens = async (user, res) => {
  const accessToken = generateToken(user);
  const refreshToken = generateRefreshToken(user);
  res.cookie("refreshToken", refreshToken, refreshCookieOptions);
  return accessToken;
};

const createAuthResponse = (user, token) => ({
  success: true,
  token,
  user: {
    id: user._id,
    role: user.role,
    name: user.name || user.username,
    username: user.username,
    email: user.email,
    mustChangePassword: !!user.mustChangePassword,
  },
  message: user.mustChangePassword
    ? "Please change your temporary password on the next screen"
    : "Login successful",
});

// ====================== REGISTER ======================
const register = async (req, res, next) => {
  try {
    const { email, password, username, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters and contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: username?.toLowerCase().trim() }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email or username already exists",
      });
    }

    const newUser = await User.create({
      email: normalizedEmail,
      username:
        username?.toLowerCase().trim() ||
        normalizedEmail.split("@")[0].replace(/[^a-z0-9_]/g, ""),
      password,
      name: name?.trim() || undefined,
      role: "user",
      isActive: true,
      mustChangePassword: false,
    });

    const accessToken = await createAuthTokens(newUser, res);

    logger.info("✅ New user registered", {
      userId: newUser._id,
      email: newUser.email,
    });

    res.status(201).json(createAuthResponse(newUser, accessToken));
  } catch (error) {
    next(error);
  }
};

// ====================== LOGIN ======================
const login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Username and password are required",
      });
    }

    const normalizedIdentifier = identifier.toLowerCase().trim();
    const user = await User.findOne({
      $or: [
        { email: normalizedIdentifier },
        { username: normalizedIdentifier },
      ],
    }).select("+password");

    if (!user) {
      logger.warn("Failed login attempt — user not found", {
        identifier: normalizedIdentifier,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!user.isActive) {
      logger.warn("Login attempt on disabled account", {
        userId: user._id,
        email: user.email,
      });
      return res.status(403).json({
        success: false,
        message: "Account is disabled",
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      logger.warn("Failed login attempt — wrong password", {
        userId: user._id,
        email: user.email,
      });
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    logger.info("✅ User logged in successfully", {
      userId: user._id,
      role: user.role,
      email: user.email,
    });

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: user._id,
        userName: user.name || user.username,
        userRole: user.role,
        action: "logged_in",
        details: `User ${user.name || user.username} logged in successfully`,
        isCritical: false,
      });
    }

    // 🔑 Generate tokens
    const accessToken = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // ✅ FIX: Do NOT add the newly issued refresh token to the blacklist.
    // The blacklist is only for revoked/rotated tokens. Adding a fresh token
    // here caused every reload to fail with "Session revoked" because the
    // browser would send this token on the next refresh call and get rejected.

    // 🍪 Set HTTP-only refresh cookie
    res.cookie("refreshToken", refreshToken, refreshCookieOptions);

    res.json({
      success: true,
      token: accessToken,
      user: {
        id: user._id,
        role: user.role,
        name: user.name || user.username,
        username: user.username,
        email: user.email,
        mustChangePassword: !!user.mustChangePassword,
      },
      message: user.mustChangePassword
        ? "Please change your temporary password on the next screen"
        : "Login successful",
    });
  } catch (error) {
    next(error);
  }
};

// ====================== CHANGE PASSWORD ======================
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters and contain at least 1 uppercase, 1 lowercase, 1 number and 1 special character (@$!%*?&)",
      });
    }

    const user = await User.findById(req.user.id).select("+password");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      logger.warn("Failed password change — wrong current password", {
        userId: user._id,
      });
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const isSamePassword = await user.matchPassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    logger.info("✅ Password changed successfully", {
      userId: user._id,
      role: user.role,
    });

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: user._id,
        userName: user.name || user.username,
        userRole: user.role,
        action: "password_changed",
        details: `User ${user.name || user.username} changed their password`,
        isCritical: true,
      });
    }

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    next(error);
  }
};

// ====================== GET CURRENT USER ======================
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ====================== LOGOUT ======================
const logout = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    // Blacklist current access token so it can't be reused after logout
    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.exp) {
          tokenBlacklist.add(token, decoded.exp);
        }
      } catch (e) {
        logger.warn("Failed to decode access token for blacklist", {
          error: e.message,
        });
      }
    }

    // 🍪 Clear HTTP-only refresh cookie
    res.clearCookie("refreshToken", refreshCookieOptions);

    logger.info("✅ User logged out", {
      userId: req.user.id,
      role: req.user.role,
    });

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name || req.user.username,
        userRole: req.user.role,
        action: "logged_out",
        details: `User ${req.user.name || req.user.username} logged out`,
        isCritical: false,
      });
    }

    res.json({ success: true, message: "Logout successful" });
  } catch (error) {
    next(error);
  }
};

// ====================== REFRESH TOKEN ======================
const refreshToken = async (req, res, next) => {
  try {
    // 🍪 Read refresh token from HTTP-only cookie
    const incomingRefreshToken = req.cookies.refreshToken;

    if (!incomingRefreshToken) {
      return res.status(401).json({
        success: false,
        message: "No active session. Please login again.",
      });
    }

    if (tokenBlacklist.isBlacklisted(incomingRefreshToken)) {
      logger.warn("Attempted refresh with blacklisted token");
      return res.status(401).json({
        success: false,
        message: "Session revoked. Please login again.",
      });
    }

    const decoded = jwt.verify(
      incomingRefreshToken,
      process.env.JWT_REFRESH_SECRET,
    );
    const userId = decoded.id || decoded.userId || decoded._id;

    const user = await User.findById(userId).select("-password");

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    // 🔒 Blacklist the OLD incoming token (rotation — prevents reuse)
    try {
      tokenBlacklist.add(incomingRefreshToken, decoded.exp);
    } catch (e) {
      logger.warn("Failed to blacklist old refresh token", {
        error: e.message,
      });
    }

    // 🔑 Generate new tokens
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // ✅ FIX: Do NOT add the newly issued refresh token to the blacklist.
    // Only the old (rotated-out) token above should be blacklisted.
    // Adding the new token here caused the very next refresh call to fail
    // with "Session revoked" — breaking session persistence on every reload.

    // 🍪 Set new HTTP-only refresh cookie
    res.cookie("refreshToken", newRefreshToken, refreshCookieOptions);

    logger.info("✅ Token refreshed successfully", {
      userId: user._id,
      role: user.role,
    });

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: user._id,
        userName: user.name || user.username,
        userRole: user.role,
        action: "token_refreshed",
        details: `User ${user.username} refreshed access token`,
        isCritical: false,
      });
    }

    res.json({
      success: true,
      token: newAccessToken,
    });
  } catch (error) {
    if (
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError"
    ) {
      logger.warn("Refresh token failed", { error: error.message });
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
      });
    }
    next(error);
  }
};

module.exports = {
  login,
  register,
  changePassword,
  getMe,
  logout,
  refreshToken,
};
