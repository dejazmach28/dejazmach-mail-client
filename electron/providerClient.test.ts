import assert from "node:assert/strict";
import test from "node:test";
import { buildPlainTextMessage, parseImapStatusLine, parseSmtpCapabilities } from "./providerClient.js";

test("parseImapStatusLine extracts numeric counters", () => {
  assert.deepEqual(parseImapStatusLine("* STATUS INBOX (MESSAGES 12 UNSEEN 4)"), {
    MESSAGES: 12,
    UNSEEN: 4
  });
});

test("parseSmtpCapabilities strips reply prefixes", () => {
  assert.deepEqual(
    parseSmtpCapabilities({
      code: 250,
      lines: ["250-mail.example.com", "250-STARTTLS", "250 AUTH PLAIN LOGIN"]
    }),
    ["STARTTLS", "AUTH PLAIN LOGIN"]
  );
});

test("buildPlainTextMessage creates a transport-safe text payload", () => {
  const message = buildPlainTextMessage({
    fromAddress: "ops@example.com",
    fromName: "Ops",
    to: "to@example.com",
    subject: "Check",
    body: ".leading line"
  });

  assert.match(message, /From: Ops <ops@example.com>/);
  assert.match(message, /\r\n\.\.leading line$/);
});
