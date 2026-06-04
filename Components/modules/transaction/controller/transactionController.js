// Server/Components/modules/transaction/controller/transactionController.js

const Transaction = require("../model/transactionModel");
const {
  recordTransactionOnBlockchain,
  verifyTransactionOnBlockchain,
} = require("../../../middlewares/blockchainMiddleware");

// ─── Helpers ────────────────────────────────────────────────────────────────

const createReferenceNumber = () => {
  return `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const VALID_TRANSACTION_TYPES = ["topup", "payment", "refund", "withdrawal"];

// ─── Controller ─────────────────────────────────────────────────────────────

const TransactionController = {
  /* ------------------------------------------------------------------ */
  /*  CREATE TRANSACTION                                                  */
  /* ------------------------------------------------------------------ */
  createTransaction: async (req, res) => {
    try {
      const { transactionType, amount, description } = req.body;

      // --- Input validation ---
      if (!transactionType || !amount) {
        return res.status(400).json({
          message: "transactionType and amount are required",
        });
      }

      if (!VALID_TRANSACTION_TYPES.includes(transactionType)) {
        return res.status(400).json({
          message: `Invalid transactionType. Must be one of: ${VALID_TRANSACTION_TYPES.join(", ")}`,
        });
      }

      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          message: "Amount must be a positive number",
        });
      }

      // --- Create transaction in DB first ---
      const referenceNumber = createReferenceNumber();

      const transaction = await Transaction.create({
        user: req.user._id,
        referenceNumber,
        transactionType,
        amount: parsedAmount,
        description: description || "",
        blockchainStatus: "Pending",
      });

      // --- Attempt blockchain recording ---
      try {
        const blockchainResult = await recordTransactionOnBlockchain({
          referenceNumber,
          transactionType,
          amount: parsedAmount,
          description: description || "",
        });

        transaction.blockchainTxHash = blockchainResult.transactionHash;
        transaction.blockchainBlockNumber = blockchainResult.blockNumber;
        transaction.blockchainStatus = blockchainResult.status;

        await transaction.save();

        return res.status(201).json({
          message: "Transaction recorded successfully",
          transaction,
        });
      } catch (blockchainError) {
        // Log full error server-side
        console.error("[Blockchain Error]", {
          message: blockchainError.message,
          reason: blockchainError.reason,
          shortMessage: blockchainError.shortMessage,
          data: blockchainError.data,
        });

        // Save failed status
        transaction.blockchainStatus = "Failed";
        await transaction.save();

        // Only expose safe details to client
        return res.status(500).json({
          message: "Transaction saved but blockchain recording failed",
          transaction,
          ...(process.env.NODE_ENV !== "production" && {
            blockchainError: {
              message: blockchainError.message,
              reason: blockchainError.reason,
              shortMessage: blockchainError.shortMessage,
            },
          }),
        });
      }
    } catch (error) {
      console.error("[createTransaction Error]", error);
      return res.status(500).json({
        message: "Transaction creation failed",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  },

  /* ------------------------------------------------------------------ */
  /*  GET MY TRANSACTIONS (with pagination)                              */
  /* ------------------------------------------------------------------ */
  getMyTransactions: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      // Optional filters
      const filter = { user: req.user._id };

      if (req.query.status) {
        const validStatuses = ["Pending", "Recorded", "Failed"];
        if (!validStatuses.includes(req.query.status)) {
          return res.status(400).json({ message: "Invalid status filter" });
        }
        filter.blockchainStatus = req.query.status;
      }

      if (req.query.type) {
        if (!VALID_TRANSACTION_TYPES.includes(req.query.type)) {
          return res.status(400).json({ message: "Invalid type filter" });
        }
        filter.transactionType = req.query.type;
      }

      const [transactions, total] = await Promise.all([
        Transaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Transaction.countDocuments(filter),
      ]);

      return res.json({
        transactions,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("[getMyTransactions Error]", error);
      return res.status(500).json({
        message: "Failed to fetch transactions",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  },

  /* ------------------------------------------------------------------ */
  /*  VERIFY TRANSACTION                                                  */
  /* ------------------------------------------------------------------ */
  verifyTransaction: async (req, res) => {
    try {
      const { referenceNumber } = req.params;

      if (!referenceNumber) {
        return res
          .status(400)
          .json({ message: "Reference number is required" });
      }

      const transaction = await Transaction.findOne({ referenceNumber });

      if (!transaction) {
        return res.status(404).json({
          message: "No transaction found in database",
        });
      }

      // Optional: ensure user can only verify their own transactions
      if (
        req.user.role === "user" &&
        transaction.user.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message: "Not authorized to verify this transaction",
        });
      }

      const blockchainRecord =
        await verifyTransactionOnBlockchain(referenceNumber);

      return res.json({
        databaseRecord: transaction,
        blockchainRecord,
        verified: blockchainRecord.exists,
      });
    } catch (error) {
      console.error("[verifyTransaction Error]", error);
      return res.status(500).json({
        message: "Verification failed",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  },

  /* ------------------------------------------------------------------ */
  /*  GET ALL TRANSACTIONS (admin only)                                  */
  /* ------------------------------------------------------------------ */
  getAllTransactions: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      const filter = {};

      if (req.query.status) {
        filter.blockchainStatus = req.query.status;
      }

      if (req.query.type) {
        filter.transactionType = req.query.type;
      }

      if (req.query.userId) {
        filter.user = req.query.userId;
      }

      const [transactions, total] = await Promise.all([
        Transaction.find(filter)
          .populate("user", "name email role") // uses shared user.model.js
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Transaction.countDocuments(filter),
      ]);

      return res.json({
        transactions,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("[getAllTransactions Error]", error);
      return res.status(500).json({
        message: "Failed to fetch transactions",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  },
};

module.exports = TransactionController;
