// Server/Components/modules/transaction/transactionRoutes.js

const express = require("express");
const TransactionController = require("./controller/transactionController");
const { Authenticate, restrictTo } = require("../../middlewares/auth");

const router = express.Router();

// ─── User Routes ─────────────────────────────────────────────────────────────

// Create a new transaction
router.post("/", Authenticate, TransactionController.createTransaction);

// Get current user's transactions
router.get(
  "/my-transactions",
  Authenticate,
  TransactionController.getMyTransactions,
);

// Verify a transaction by reference number
router.get(
  "/verify/:referenceNumber",
  Authenticate,
  TransactionController.verifyTransaction,
);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

// Get all transactions (admin only)
router.get(
  "/all",
  Authenticate,
  restrictTo("admin"),
  TransactionController.getAllTransactions,
);

module.exports = router;
