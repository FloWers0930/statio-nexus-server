// backend/src/modules/invite/invite.controller.js
const crypto = require("crypto");
const User = require("../shared/user.model.js");
const { sendAdminInviteEmail } = require("../../config/email.js");
const logger = require("../../config/logger.js");

// ── Audit helper ──────────────────────────────────────────────────────────────
function audit(req, entry) {
  const fn = req.app?.locals?.emitAuditLog;
  if (!fn) return;
  fn({
    user: req.user._id,
    userName: req.user.name || req.user.username,
    userRole: req.user.role,
    isCritical: false,
    ...entry,
  });
}

// ─── POST /api/invite/admin ───────────────────────────────────────────────────
// Owner or Admin sends an invite to a new admin
exports.inviteAdmin = async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email || !name) {
      return res
        .status(400)
        .json({ success: false, message: "Email and name are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already registered
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    // Generate secure invite token (hex, 64 chars)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    // Create a pending user account (no password yet)
    const pendingUser = await User.create({
      username:
        normalizedEmail
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") +
        "_" +
        Date.now().toString(36),
      email: normalizedEmail,
      name: name.trim(),
      role: "admin",
      isActive: false, // inactive until they set their password
      accountSetupComplete: false,
      inviteToken: hashedToken,
      inviteExpires: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
      invitedBy: req.user._id,
      // password intentionally omitted — set during accept-invite
    });

    // Send the invite email with the RAW token (not hashed)
    const sent = await sendAdminInviteEmail(
      normalizedEmail,
      name.trim(),
      rawToken,
      req.user.name || req.user.username,
    );

    if (!sent) {
      // Clean up if email fails
      await User.findByIdAndDelete(pendingUser._id);
      return res
        .status(500)
        .json({
          success: false,
          message: "Failed to send invite email. Please try again.",
        });
    }

    logger.info(`Admin invite sent to ${normalizedEmail} by ${req.user.email}`);

    audit(req, {
      action: "staff_created",
      details: `Sent admin invite to "${name.trim()}" (${normalizedEmail})`,
      newValue: { email: normalizedEmail, name: name.trim(), role: "admin" },
      isCritical: false,
    });

    res.status(201).json({
      success: true,
      message: `Invite sent to ${normalizedEmail}. The link expires in 48 hours.`,
    });
  } catch (err) {
    logger.error("inviteAdmin error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── GET /api/invite/verify?token=xxx ────────────────────────────────────────
// Frontend calls this to check if the token is valid before showing the form
exports.verifyInviteToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Token is required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      inviteToken: hashedToken,
      inviteExpires: { $gt: new Date() },
      accountSetupComplete: false,
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This invite link is invalid or has expired. Please request a new one.",
      });
    }

    res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    logger.error("verifyInviteToken error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/invite/accept ──────────────────────────────────────────────────
// Admin sets their password using the invite token
exports.acceptInvite = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Token and password are required" });
    }

    const PASSWORD_REGEX =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number and 1 special character (@$!%*?&)",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      inviteToken: hashedToken,
      inviteExpires: { $gt: new Date() },
      accountSetupComplete: false,
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This invite link is invalid or has expired. Please request a new one.",
      });
    }

    // Set password and activate account
    user.password = password; // pre-save hook will hash it
    user.isActive = true;
    user.accountSetupComplete = true;
    user.mustChangePassword = false;
    user.inviteToken = null;
    user.inviteExpires = null;
    await user.save();

    logger.info(`Admin account activated: ${user.email}`);

    res.json({
      success: true,
      message:
        "Account activated! You can now log in with your email and new password.",
    });
  } catch (err) {
    logger.error("acceptInvite error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/invite/resend ──────────────────────────────────────────────────
// Owner/Admin resends an invite if token expired
exports.resendInvite = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      accountSetupComplete: false,
      role: "admin",
    }).select("+inviteToken");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No pending admin invite found for this email",
      });
    }

    // Generate a new token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    user.inviteToken = hashedToken;
    user.inviteExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const sent = await sendAdminInviteEmail(
      user.email,
      user.name,
      rawToken,
      req.user.name || req.user.username,
    );

    if (!sent) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to resend invite email" });
    }

    logger.info(`Admin invite resent to ${user.email} by ${req.user.email}`);

    res.json({ success: true, message: `Invite resent to ${user.email}` });
  } catch (err) {
    logger.error("resendInvite error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
