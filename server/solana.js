const { Connection, PublicKey } = require('@solana/web3.js');
const gameLogic = require('./gameLogic');

// ============================================
// SOLANA WALLET MONITOR
// ============================================
// Monitors the dev wallet for incoming taxes
// Updates prize pool when taxes are detected
// ============================================

const CONFIG = {
  RPC_URL: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  DEV_WALLET: process.env.DEV_WALLET || '',
  POLL_INTERVAL_MS: 10000, // Check every 10 seconds
  TAX_PERCENTAGE: 0.05, // 5% of transactions are taxes
};

let connection = null;
let lastSignature = null;
let isMonitoring = false;
let monitorInterval = null;

// Initialize Solana connection
function initConnection() {
  if (!CONFIG.DEV_WALLET) {
    console.log('[Solana] No DEV_WALLET configured, monitoring disabled');
    return false;
  }

  try {
    connection = new Connection(CONFIG.RPC_URL, 'confirmed');
    console.log('[Solana] Connected to:', CONFIG.RPC_URL);
    console.log('[Solana] Monitoring wallet:', CONFIG.DEV_WALLET);
    return true;
  } catch (err) {
    console.error('[Solana] Connection failed:', err.message);
    return false;
  }
}

// Get recent transactions for the dev wallet
async function getRecentTransactions() {
  if (!connection || !CONFIG.DEV_WALLET) return [];

  try {
    const pubkey = new PublicKey(CONFIG.DEV_WALLET);
    const signatures = await connection.getSignaturesForAddress(pubkey, {
      limit: 20,
      before: lastSignature ? lastSignature : undefined
    });

    return signatures;
  } catch (err) {
    console.error('[Solana] Error fetching transactions:', err.message);
    return [];
  }
}

// Parse transaction to extract tax amount
async function parseTransaction(signature) {
  if (!connection) return null;

  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) return null;

    // Calculate the net change for our wallet
    const preBalance = tx.meta.preBalances[0] || 0;
    const postBalance = tx.meta.postBalances[0] || 0;
    const change = (postBalance - preBalance) / 1e9; // Convert lamports to SOL

    // Only count incoming transactions (positive change)
    if (change > 0) {
      return {
        signature,
        amount: change,
        timestamp: tx.blockTime ? tx.blockTime * 1000 : Date.now()
      };
    }

    return null;
  } catch (err) {
    console.error('[Solana] Error parsing transaction:', err.message);
    return null;
  }
}

// Check for new taxes and update prize pool
async function checkForTaxes() {
  if (!connection || !CONFIG.DEV_WALLET) return;

  const signatures = await getRecentTransactions();

  if (signatures.length === 0) return;

  // Update last signature for pagination
  if (!lastSignature && signatures.length > 0) {
    lastSignature = signatures[0].signature;
    console.log('[Solana] Initial sync complete, watching for new transactions...');
    return; // Skip initial sync to avoid processing old transactions
  }

  // Process new transactions
  for (const sig of signatures) {
    if (sig.signature === lastSignature) break;

    const tx = await parseTransaction(sig.signature);
    if (tx && tx.amount > 0) {
      // Add tax to prize pool
      const newPool = gameLogic.addTaxesToPool(tx.amount);
      console.log(`[Solana] Tax received: ${tx.amount.toFixed(6)} SOL | Pool: ${newPool.toFixed(6)} SOL`);
    }
  }

  // Update last signature
  if (signatures.length > 0) {
    lastSignature = signatures[0].signature;
  }
}

// Start monitoring
function startMonitoring() {
  if (isMonitoring) return;

  if (!initConnection()) {
    console.log('[Solana] Monitoring not started (no wallet configured)');
    return;
  }

  isMonitoring = true;

  // Initial check
  checkForTaxes();

  // Set up polling interval
  monitorInterval = setInterval(checkForTaxes, CONFIG.POLL_INTERVAL_MS);
  console.log('[Solana] Monitoring started, checking every', CONFIG.POLL_INTERVAL_MS / 1000, 'seconds');
}

// Stop monitoring
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  isMonitoring = false;
  console.log('[Solana] Monitoring stopped');
}

// Check and distribute prizes (called periodically)
function checkPrizeDistribution() {
  const result = gameLogic.checkDistribution();
  if (result) {
    console.log('[Prize] Distribution triggered!');
    if (result.winner) {
      console.log(`[Prize] Winner: ${result.winner.username} (Level ${result.winner.level})`);
      console.log(`[Prize] Amount: ${result.prizeAmount.toFixed(6)} SOL`);
      console.log(`[Prize] Wallet: ${result.winner.wallet}`);
      // TODO: Implement actual Solana transfer here
      // For now, just log and record in DB
    } else {
      console.log('[Prize] No eligible winner this period');
    }
    console.log('[Prize] Next distribution at:', new Date(result.nextDistributionAt).toISOString());
  }
  return result;
}

// Start prize distribution checker
let distributionInterval = null;

function startDistributionChecker() {
  // Check every minute
  distributionInterval = setInterval(checkPrizeDistribution, 60000);
  console.log('[Prize] Distribution checker started');
}

function stopDistributionChecker() {
  if (distributionInterval) {
    clearInterval(distributionInterval);
    distributionInterval = null;
  }
}

// Get monitoring status
function getStatus() {
  return {
    isMonitoring,
    wallet: CONFIG.DEV_WALLET ? CONFIG.DEV_WALLET.substring(0, 8) + '...' : 'Not configured',
    rpc: CONFIG.RPC_URL,
    prizePool: gameLogic.getPrizePoolInfo()
  };
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  checkPrizeDistribution,
  startDistributionChecker,
  stopDistributionChecker,
  getStatus,
  CONFIG
};
