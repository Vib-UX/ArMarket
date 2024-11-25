const express = require("express");
const ArLocal = require("arlocal").default;
const Arweave = require("arweave");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const cors = require("cors");
const { TurboFactory } = require("@ardrive/turbo-sdk");

const app = express();
const port = 3000;

// Middleware for JSON parsing
app.use(express.json());
app.use(cors());

// Setup Multer for file uploads
const upload = multer({ dest: "uploads/" });

// Initialize ArLocal and Arweave
let arLocal;
let arweave;

// Start ArLocal and initialize Arweave
const initialize = async () => {
  arLocal = new ArLocal(1984, true, "./db", true);
  await arLocal.start();

  arweave = Arweave.init({
    host: "localhost",
    port: 1984,
    protocol: "http",
  });

  console.log("ArLocal started on port 1984");
};

// Stop ArLocal on server shutdown
const cleanup = async () => {
  if (arLocal) {
    await arLocal.stop();
    console.log("ArLocal stopped");
  }
};

// File Upload Endpoint
app.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "File is required" });
    }

    // Load JWK from server directory
    const jwkPath = path.join(__dirname, "jwk.json");
    console.log(jwkPath);
    const jwk = JSON.parse(fs.readFileSync(jwkPath, "utf8"));

    const filePath = file.path;
    const turbo = TurboFactory.authenticated({ privateKey: jwk });
    const address = await arweave.wallets.jwkToAddress(jwk);
    const fileSize = fs.statSync(filePath).size;

    // Get the cost of uploading the file
    const [{ winc: fileSizeCost }] = await turbo.getUploadCosts({
      bytes: [fileSize],
    });
    const { winc: balance } = await turbo.getBalance();

    // if (balance < fileSizeCost) {
    //   const { url } = await turbo.createCheckoutSession({
    //     amount: fileSizeCost,
    //     owner: address,
    //   });
    //   return res
    //     .status(402)
    //     .json({ message: "Insufficient balance. Top-up required.", url });
    // }

    // Upload the file
    const { id, owner, dataCaches, fastFinalityIndexes } =
      await turbo.uploadFile({
        fileStreamFactory: () => fs.createReadStream(filePath),
        fileSizeFactory: () => fileSize,
      });

    // Cleanup uploaded file
    // fs.unlinkSync(filePath);

    res.status(200).json({
      message: "File uploaded successfully!",
      id,
      owner,
      dataCaches,
      fastFinalityIndexes,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate Wallet
app.post("/generate-wallet", async (req, res) => {
  try {
    const wallet = await arweave.wallets.generate();
    const addr = await arweave.wallets.getAddress(wallet);
    console.log(addr);
    await arweave.api.get(`mint/${addr}/10000000000000000`);

    res.status(200).json({ wallet, addr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Wallet Address
app.post("/get-address", async (req, res) => {
  try {
    const { wallet } = req.body;
    const addr = await arweave.wallets.getAddress(wallet);
    res.status(200).json({ addr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Wallet Balance
app.get("/balance/:addr", async (req, res) => {
  try {
    const { addr } = req.params;
    const balance = await arweave.wallets.getBalance(addr);
    res.status(200).json({ addr, balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post Transaction
app.post("/post-transaction", async (req, res) => {
  try {
    const { wallet, data } = req.body;
    const transaction = await arweave.createTransaction({ data }, wallet);

    // Sign and post the transaction
    await arweave.transactions.sign(transaction, wallet);
    const response = await arweave.transactions.post(transaction);

    // Mine the transaction
    await arweave.api.get("mine");

    res.status(200).json({ transaction, response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Transaction by ID
app.get("/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await arweave.transactions.get(id);
    res.status(200).json(transaction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start the server
app.listen(port, async () => {
  await initialize();
  console.log(`Server is running at http://localhost:${port}`);
});

// Handle cleanup on shutdown
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
