const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    referenceNumber: {
      type: String,
      required: true,
      unique: true,
    },

    transactionType: {
      type: String,
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    blockchainTxHash: {
      type: String,
      default: "",
    },

    blockchainBlockNumber: {
      type: Number,
      default: null,
    },

    blockchainStatus: {
      type: String,
      enum: ["Pending", "Recorded", "Failed"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);