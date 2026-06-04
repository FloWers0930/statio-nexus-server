// backend/src/middlewares/requestLogger.js
const crypto = require("crypto");
const logger = require("../config/logger.js");

const loggerMiddleware = (req, res, next) => {
  // Generate unique request ID for tracking
  const requestId = crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const { method, originalUrl, ip } = req;
    const { statusCode } = res;

    logger.http(`[${requestId}] ${method} ${originalUrl} ${statusCode} - ${duration}ms (${ip})`, {
      requestId,
      method,
      path: originalUrl,
      statusCode,
      duration,
      ip,
      userId: req.user?.id,
    });
  });

  next();
};

module.exports = loggerMiddleware;
