// Server/Components/middlewares/blockchainMiddleware.js

const { ethers } = require("ethers");
const { wallet } = require("../config/blockchain");
const contractJson = require("../abis/TransactionLedger.json");

// ─── Validation ───────────────────────────────────────────────────────────────

if (!process.env.CONTRACT_ADDRESS) {
  throw new Error("Missing required environment variable: CONTRACT_ADDRESS");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getContract = () => {
  return new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractJson.abi,
    wallet,
  );
};

// ─── Functions ────────────────────────────────────────────────────────────────

const recordTransactionOnBlockchain = async ({
  referenceNumber,
  transactionType,
  amount,
  description,
}) => {
  if (!referenceNumber || !transactionType || amount === undefined) {
    throw new Error(
      "referenceNumber, transactionType, and amount are required",
    );
  }

  const contract = getContract();

  // Convert amount to BigInt — smart contracts require integer values
  // Multiply by 100 to preserve 2 decimal places (e.g. 10.50 → 1050)
  const amountInCents = BigInt(Math.round(Number(amount) * 100));

  const tx = await contract.recordTransaction(
    referenceNumber,
    transactionType,
    amountInCents,
    description || "",
  );

  const receipt = await tx.wait();

  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? "Recorded" : "Failed",
  };
};

const verifyTransactionOnBlockchain = async (referenceNumber) => {
  if (!referenceNumber) {
    throw new Error("referenceNumber is required");
  }

  const contract = getContract();

  const result = await contract.verifyTransaction(referenceNumber);

  return {
    referenceNumber: result[0],
    transactionType: result[1],
    // Convert back from cents to decimal
    amount: (Number(result[2]) / 100).toFixed(2),
    description: result[3],
    recordedBy: result[4],
    timestamp: result[5].toString(),
    exists: result[6],
  };
};

module.exports = {
  recordTransactionOnBlockchain,
  verifyTransactionOnBlockchain,
};
