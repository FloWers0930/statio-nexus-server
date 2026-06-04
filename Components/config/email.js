// backend/src/config/email.js
require("dotenv").config();
const nodemailer = require("nodemailer");
const logger = require("./logger");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    logger.error("Email transporter verification failed", {
      error: error.message,
    });
  } else {
    logger.info("✅ Email transporter is ready");
  }
});

// ==================== RETRY HELPER ====================
const sendWithRetry = async (mailOptions, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      if (attempt > 1) {
        logger.info(`📧 Email sent on attempt ${attempt}`);
      }
      return true;
    } catch (error) {
      if (attempt === retries) {
        logger.error(`❌ Email failed after ${retries} attempts`, {
          error: error.message,
          to: mailOptions.to,
        });
        return false;
      }
      const waitTime = delay * Math.pow(2, attempt - 1);
      logger.warn(
        `📧 Email attempt ${attempt} failed, retrying in ${waitTime}ms`,
        {
          error: error.message,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
};

// ==================== EXISTING FUNCTIONS ====================

const sendNewTicketNotification = async (ticket) => {
  const ticketId = (ticket._id || ticket.id).toString();
  const mailOptions = {
    from: `"Statio Nexus Support" <${
      process.env.EMAIL_FROM || process.env.SMTP_USER
    }>`,
    to: process.env.SUPPORT_EMAIL,
    subject: `🔔 New Support Ticket #${ticketId.slice(-6)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">New Support Ticket Received</h2>
        <p><strong>Ticket ID:</strong> ${ticketId.slice(-8)}</p>
        <p><strong>Customer:</strong> ${ticket.customer?.name || "Unknown"} (${
      ticket.customer?.email || "—"
    })</p>
        <p><strong>Category:</strong> ${ticket.category || "Other"}</p>
        <p><strong>Status:</strong> ${ticket.status}</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>Title:</strong> ${ticket.title || ticket.subject}<br><br>
          <strong>Description:</strong><br>${
            ticket.description || ticket.message
          }
        </div>
        <p><a href="${
          process.env.FRONTEND_URL || "http://localhost:5173"
        }/admin/support" style="color: #0f766e; font-weight: bold;">View Ticket in Admin Panel →</a></p>
        <p style="font-size: 12px; color: #666; margin-top: 30px;">This is an automated notification from Statio Nexus.</p>
      </div>
    `,
  };

  return sendWithRetry(mailOptions);
};

const sendSupportReply = async (toEmail, ticket, replyMessage) => {
  const ticketId = (ticket._id || ticket.id).toString();
  const mailOptions = {
    from: `"Statio Nexus Support" <${
      process.env.EMAIL_FROM || process.env.SMTP_USER
    }>`,
    to: toEmail,
    subject: `Re: ${ticket.title || ticket.subject} (#${ticketId.slice(-6)})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f766e;">Statio Nexus Support</h2>
        <p>Hi ${ticket.customer?.name || "Customer"},</p>
        <p>We have replied to your support ticket:</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>Your Ticket:</strong><br>
          <strong>${ticket.title || ticket.subject}</strong><br>
          ${ticket.description || ticket.message}
        </div>
        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>Our Reply:</strong><br>${replyMessage.replace(/\n/g, "<br>")}
        </div>
        <p>If you have any further questions, feel free to reply to this email.</p>
        <p>Best regards,<br><strong>Statio Nexus Support Team</strong></p>
        <hr>
        <p style="font-size: 12px; color: #666;">Ticket ID: ${ticketId.slice(
          -8,
        )}</p>
      </div>
    `,
  };

  return sendWithRetry(mailOptions);
};

// ==================== NEW FUNCTION ====================

const sendTemporaryPasswordEmail = async (toEmail, name, tempPassword) => {
  const loginUrl = `${
    process.env.FRONTEND_URL || "http://localhost:5173"
  }/login`;
  const mailOptions = {
    from: `"Statio Nexus HR" <${
      process.env.EMAIL_FROM || process.env.SMTP_USER
    }>`,
    to: toEmail,
    subject: "🔐 Your Temporary Login Credentials",
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <h2 style="color: #0f172a; margin: 0 0 8px; font-size: 22px;">Welcome to StatioNexus, ${name}!</h2>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 20px;">Your manager has added you to the team. Use the temporary password below to log in for the first time.</p>

        <div style="background: #f8fafc; padding: 16px; border-radius: 12px; margin: 20px 0; text-align: center; border: 1px dashed #cbd5e1;">
          <p style="margin: 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Temporary Password</p>
          <p style="margin: 8px 0 0; font-size: 24px; font-weight: bold; font-family: ui-monospace, SFMono-Regular, monospace; color: #0f172a; letter-spacing: 2px;">${tempPassword}</p>
        </div>

        <a href="${loginUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">Log In Now</a>

        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; line-height: 1.5;">
          ⚠️ For security, you will be required to change this password immediately after your first login.<br>
          If you did not expect this invitation, please contact your system administrator.
        </p>
      </div>
    `,
  };

  return sendWithRetry(mailOptions);
};

// ==================== EXPORTS ====================
module.exports = {
  sendNewTicketNotification,
  sendSupportReply,
  sendTemporaryPasswordEmail, // ✅ Added new export
};
