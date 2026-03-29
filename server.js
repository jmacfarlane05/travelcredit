require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const path = require("path");
const { parseCreditsFromMessages } = require("./parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// In-memory store of parsed credits per session (in production, use a DB)
let cachedCredits = [];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`
  );
}

// Stored tokens (in production, persist per-user)
let storedTokens = null;

// Step 1: Redirect user to Google consent screen
app.get("/auth/google", (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
  res.redirect(url);
});

// Step 2: Handle OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("Missing authorization code");
  }
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    storedTokens = tokens;
    res.redirect("/?connected=1");
  } catch (err) {
    console.error("OAuth error:", err.message);
    res.status(500).send("Authentication failed. Check your credentials.");
  }
});

// Step 3: Check if connected
app.get("/api/status", (req, res) => {
  res.json({ connected: !!storedTokens });
});

// Step 4: Scan Gmail for flight credit emails
app.post("/api/scan", async (req, res) => {
  if (!storedTokens) {
    return res.status(401).json({ error: "Not connected to Gmail" });
  }

  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(storedTokens);

    // Refresh token if expired
    oauth2Client.on("tokens", (tokens) => {
      if (tokens.refresh_token) {
        storedTokens.refresh_token = tokens.refresh_token;
      }
      storedTokens.access_token = tokens.access_token;
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Search for flight credit / voucher emails from airlines
    const searchQueries = [
      "subject:(flight credit) newer_than:2y",
      "subject:(travel credit) newer_than:2y",
      "subject:(travel voucher) newer_than:2y",
      "subject:(flight voucher) newer_than:2y",
      "subject:(airline credit) newer_than:2y",
      "subject:(booking credit) newer_than:2y",
      "subject:(travel funds) newer_than:2y",
      "subject:(eCredit) newer_than:2y",
      "subject:(future flight credit) newer_than:2y",
      "subject:(cancellation credit) newer_than:2y",
      "subject:(refund credit) newer_than:2y",
    ];

    const messageIds = new Set();

    for (const q of searchQueries) {
      try {
        const result = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: 50,
        });
        if (result.data.messages) {
          result.data.messages.forEach((m) => messageIds.add(m.id));
        }
      } catch {
        // Some queries may match nothing, that's fine
      }
    }

    // Fetch full messages
    const messages = [];
    for (const id of messageIds) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      messages.push(msg.data);
    }

    // Parse credits from emails
    cachedCredits = parseCreditsFromMessages(messages);

    res.json({ credits: cachedCredits, scanned: messageIds.size });
  } catch (err) {
    console.error("Scan error:", err.message);
    if (err.message.includes("invalid_grant") || err.message.includes("Token")) {
      storedTokens = null;
      return res.status(401).json({ error: "Session expired. Please reconnect." });
    }
    res.status(500).json({ error: "Failed to scan emails" });
  }
});

// Get cached credits
app.get("/api/credits", (req, res) => {
  res.json({ credits: cachedCredits });
});

// Dismiss / manually remove a credit
app.delete("/api/credits/:id", (req, res) => {
  cachedCredits = cachedCredits.filter((c) => c.id !== req.params.id);
  res.json({ credits: cachedCredits });
});

// Disconnect Gmail
app.post("/api/disconnect", (req, res) => {
  storedTokens = null;
  cachedCredits = [];
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Flight Credit Tracker running at http://localhost:${PORT}`);
});
