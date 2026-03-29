// Parses flight credit information from Gmail messages

const AIRLINE_PATTERNS = [
  { name: "Delta Air Lines", patterns: [/delta/i] },
  { name: "United Airlines", patterns: [/united\s*air/i, /from:\s*united/i] },
  { name: "American Airlines", patterns: [/american\s*air/i, /aa\.com/i] },
  { name: "Southwest Airlines", patterns: [/southwest/i] },
  { name: "JetBlue", patterns: [/jetblue/i] },
  { name: "Alaska Airlines", patterns: [/alaska\s*air/i] },
  { name: "Spirit Airlines", patterns: [/spirit\s*air/i] },
  { name: "Frontier Airlines", patterns: [/frontier\s*air/i] },
  { name: "Hawaiian Airlines", patterns: [/hawaiian\s*air/i] },
  { name: "Sun Country", patterns: [/sun\s*country/i] },
  { name: "Allegiant Air", patterns: [/allegiant/i] },
  { name: "Air Canada", patterns: [/air\s*canada/i] },
  { name: "WestJet", patterns: [/westjet/i] },
  { name: "British Airways", patterns: [/british\s*air/i] },
  { name: "Lufthansa", patterns: [/lufthansa/i] },
  { name: "Emirates", patterns: [/emirates/i] },
  { name: "Qatar Airways", patterns: [/qatar/i] },
  { name: "Qantas", patterns: [/qantas/i] },
];

// Amount patterns: $123.45, USD 123.45, 123.45 USD, etc.
const AMOUNT_PATTERNS = [
  /\$\s?([\d,]+\.?\d{0,2})/,
  /USD\s?([\d,]+\.?\d{0,2})/i,
  /([\d,]+\.?\d{0,2})\s?USD/i,
];

// Credit/confirmation code patterns
const CODE_PATTERNS = [
  /confirmation[:\s#]*([A-Z0-9]{5,8})/i,
  /credit\s*(?:code|number|#|:)\s*([A-Z0-9]{5,12})/i,
  /voucher\s*(?:code|number|#|:)\s*([A-Z0-9]{5,12})/i,
  /e-?credit[:\s#]*([A-Z0-9]{5,12})/i,
  /reference[:\s#]*([A-Z0-9]{5,8})/i,
  /PNR[:\s#]*([A-Z0-9]{5,8})/i,
];

// Expiration date patterns
const EXPIRY_PATTERNS = [
  /expir\w*[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i,
  /valid\s*(?:through|until|thru)[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i,
  /use\s*by[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i,
  /expir\w*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  /valid\s*(?:through|until|thru)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  /use\s*by[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  /expir\w*[:\s]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
];

function getHeader(headers, name) {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function decodeBody(message) {
  let text = "";

  function extractParts(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body && part.body.data) {
        text += Buffer.from(part.body.data, "base64url").toString("utf-8");
      } else if (part.mimeType === "text/html" && part.body && part.body.data) {
        // Strip HTML tags for text extraction
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        text += html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      } else if (part.parts) {
        extractParts(part.parts);
      }
    }
  }

  if (message.payload.body && message.payload.body.data) {
    text = Buffer.from(message.payload.body.data, "base64url").toString("utf-8");
  }
  if (message.payload.parts) {
    extractParts(message.payload.parts);
  }

  return text;
}

function detectAirline(subject, from, body) {
  const combined = `${subject} ${from} ${body}`;
  for (const airline of AIRLINE_PATTERNS) {
    for (const pattern of airline.patterns) {
      if (pattern.test(combined)) {
        return airline.name;
      }
    }
  }
  return null;
}

function extractAmount(text) {
  // Look for amounts near credit/voucher keywords
  const creditContext =
    /(?:credit|voucher|funds|e-?credit|refund).{0,100}/gi;
  const matches = text.match(creditContext) || [];

  for (const context of matches) {
    for (const pattern of AMOUNT_PATTERNS) {
      const match = context.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ""));
        if (amount > 0 && amount < 100000) {
          return amount;
        }
      }
    }
  }

  // Fallback: look for any dollar amount in the full text
  for (const pattern of AMOUNT_PATTERNS) {
    const allMatches = [...text.matchAll(new RegExp(pattern, "g"))];
    // Pick the largest reasonable amount
    const amounts = allMatches
      .map((m) => parseFloat(m[1].replace(/,/g, "")))
      .filter((a) => a > 10 && a < 100000)
      .sort((a, b) => b - a);
    if (amounts.length > 0) {
      return amounts[0];
    }
  }

  return null;
}

function extractCode(text) {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

function extractExpiration(text) {
  for (const pattern of EXPIRY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
        return parsed.toISOString().split("T")[0];
      }
      // Try MM/DD/YYYY or similar
      const parts = match[1].split(/[\/\-]/);
      if (parts.length === 3) {
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000;
        const month = parseInt(parts[0]) - 1;
        const day = parseInt(parts[1]);
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
          return d.toISOString().split("T")[0];
        }
      }
    }
  }
  return null;
}

function parseCreditsFromMessages(messages) {
  const credits = [];
  const seenKeys = new Set();

  for (const message of messages) {
    const headers = message.payload.headers || [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    const date = getHeader(headers, "Date");
    const body = decodeBody(message);
    const fullText = `${subject}\n${body}`;

    const airline = detectAirline(subject, from, body);
    if (!airline) continue;

    const amount = extractAmount(fullText);
    if (!amount) continue;

    const code = extractCode(fullText);
    const expiration = extractExpiration(fullText);

    // Deduplicate by airline + amount + code
    const key = `${airline}-${amount}-${code || ""}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    credits.push({
      id: message.id,
      airline,
      amount,
      confirmationCode: code,
      expirationDate: expiration,
      emailSubject: subject,
      emailDate: date,
      source: "gmail",
    });
  }

  return credits;
}

module.exports = { parseCreditsFromMessages };
