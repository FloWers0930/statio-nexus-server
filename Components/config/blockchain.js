// Server/Components/config/blockchain.js

const { ethers } = require("ethers");

const requiredVars = ["BESU_RPC_URL", "SERVER_WALLET_PRIVATE_KEY"];
const missing = requiredVars.filter((v) => !process.env[v]);

if (missing.length > 0) {
  throw new Error(
    `Missing required blockchain environment variables: ${missing.join(", ")}`,
  );
}

const provider = new ethers.JsonRpcProvider(process.env.BESU_RPC_URL);

const wallet = new ethers.Wallet(
  process.env.SERVER_WALLET_PRIVATE_KEY,
  provider,
);

module.exports = { provider, wallet };
