// backend/src/services/notificationService.js
const logger = require("../config/logger.js");

class NotificationService {
  constructor(io) {
    this.io = io;
    logger.info("✅ NotificationService running in In-Memory Socket.IO mode");
  }

  publish(channel, payload) {
    logger.info(`📤 EMIT → ${channel}`, { module: "notification" });

    switch (channel) {
      // ── Global broadcast ──────────────────────────────────────────────────
      case "notifications:global":
        this.io.emit("notification", payload);
        break;

      // ── Audit room — admins watching audit trail ──────────────────────────
      case "notifications:audit":
        this.io.to("admin:audit").emit("auditLogUpdated", payload);
        break;

      // ── Booking events ────────────────────────────────────────────────────
      // Mobile user gets their own notification
      // Admin gets notified for every booking event
      case "notifications:booking":
        if (payload.userId) {
          this.io.to(`user:${payload.userId}`).emit("bookingUpdated", payload);
        }
        this.io.to("admin:notifications").emit("bookingUpdated", payload);
        break;

      // ── Spot events — admin notified ──────────────────────────────────────
      case "notifications:spot":
        this.io.to("admin:notifications").emit("spotUpdated", payload);
        break;

      // ── Staff events — admin notified ─────────────────────────────────────
      case "notifications:staff":
        this.io.to("admin:notifications").emit("staffUpdated", payload);
        break;

      // ── User events — admin notified ──────────────────────────────────────
      case "notifications:user":
        this.io.to("admin:notifications").emit("userUpdated", payload);
        break;

      default:
        this.io.emit("notification", payload);
    }
  }

  // ── Convenience methods ───────────────────────────────────────────────────

  async sendGlobalNotification(notification) {
    return this.publish("notifications:global", {
      type: "global",
      timestamp: new Date(),
      ...notification,
    });
  }

  async sendAuditNotification(auditData) {
    return this.publish("notifications:audit", auditData);
  }

  async sendBookingNotification(data) {
    return this.publish("notifications:booking", {
      type: "booking",
      timestamp: new Date(),
      ...data,
    });
  }

  async sendSpotNotification(data) {
    return this.publish("notifications:spot", {
      type: "spot",
      timestamp: new Date(),
      ...data,
    });
  }

  async sendStaffNotification(data) {
    return this.publish("notifications:staff", {
      type: "staff",
      timestamp: new Date(),
      ...data,
    });
  }

  async sendUserNotification(data) {
    return this.publish("notifications:user", {
      type: "user",
      timestamp: new Date(),
      ...data,
    });
  }

  getStatus() {
    return {
      pubSubEnabled: false,
      mode: "In-Memory Socket.IO",
    };
  }
}

module.exports = NotificationService;
