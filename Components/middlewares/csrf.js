// backend/src/middlewares/csrf.js

const crypto = require("crypto");
const logger = require("../config/logger");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE_NAME = "csrfToken";
const CSRF_TTL_MS = 24 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: false, // Client must read token and send it back via header/body
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: CSRF_TTL_MS,
};

// Generate CSRF token
const generateCSRFToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// Validate CSRF token for unsafe methods
const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const tokenFromBody = req.body?.csrfToken;
  const tokenFromHeader = req.headers["x-csrf-token"];
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE_NAME];
  const providedToken = tokenFromHeader || tokenFromBody;

  if (!tokenFromCookie || !providedToken || tokenFromCookie !== providedToken) {
    logger.warn("CSRF token validation failed", {
      ip: req.ip,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
    });

    return res.status(403).json({
      success: false,
      message: "CSRF token validation failed",
    });
  }

  next();
};

// Ensure CSRF cookie exists so clients can include it in unsafe requests
const generateNewCSRFToken = (req, res, next) => {
  const existingToken = req.cookies?.[CSRF_COOKIE_NAME];
  if (existingToken) {
    res.locals.csrfToken = existingToken;
    return next();
  }

  const newToken = generateCSRFToken();
  res.cookie(CSRF_COOKIE_NAME, newToken, cookieOptions);
  res.locals.csrfToken = newToken;
  next();
};

module.exports = {
  csrfProtection,
  generateNewCSRFToken,
  generateCSRFToken,
};
