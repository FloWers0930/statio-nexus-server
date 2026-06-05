// Server/Components/config/blockchain.js
const { ethers } = require("ethers");

let provider = null;
let wallet = null;

const requiredVars = ["BESU_RPC_URL", "SERVER_WALLET_PRIVATE_KEY"];
const missing = requiredVars.filter((v) => !process.env[v]);

if (missing.length > 0) {
  console.warn(
    `⚠️ Blockchain disabled - missing env vars: ${missing.join(", ")}`,
  );
} else {
  try {
    provider = new ethers.JsonRpcProvider(process.env.BESU_RPC_URL);
    wallet = new ethers.Wallet(process.env.SERVER_WALLET_PRIVATE_KEY, provider);

    // Test connection asynchronously (won't block server startup)
    provider
      .getBlockNumber()
      .then(() => console.log("✅ Blockchain connected"))
      .catch((err) => console.warn("⚠️ Blockchain RPC failed:", err.message));
  } catch (error) {
    console.warn("⚠️ Blockchain init failed:", error.message);
  }
}

module.exports = { provider, wallet };
