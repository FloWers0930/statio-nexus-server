// backend/src/modules/invite/invite.routes.js
const express = require("express");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const {
  inviteAdmin,
  verifyInviteToken,
  acceptInvite,
  resendInvite,
} = require("./invite.controller.js");

const router = express.Router();

// ── Public (no auth needed — user doesn't have an account yet) ────────────────
router.get("/verify", verifyInviteToken); // GET  /api/invite/verify?token=xxx
router.post("/accept", acceptInvite); // POST /api/invite/accept

// ── Protected (owner or admin only) ──────────────────────────────────────────
router.use(Authenticate);
router.post("/admin", restrictTo("owner", "admin"), inviteAdmin); // POST /api/invite/admin
router.post("/resend", restrictTo("owner", "admin"), resendInvite); // POST /api/invite/resend

module.exports = router;
