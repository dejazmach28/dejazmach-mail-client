import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlainTextMessage,
  parseImapFetchEnvelope,
  parseImapListLine,
  parseImapStatusLine,
  parseSmtpCapabilities
} from "./providerClient.js";

test("parseImapStatusLine extracts numeric counters", () => {
  assert.deepEqual(parseImapStatusLine("* STATUS INBOX (MESSAGES 12 UNSEEN 4)"), {
    MESSAGES: 12,
    UNSEEN: 4
  });
});

test("parseImapListLine extracts folder name and attributes", () => {
  assert.deepEqual(parseImapListLine('* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"'), {
    attributes: ["hasnochildren", "sent"],
    delimiter: "/",
    name: "Sent Items"
  });
});

test("parseImapFetchEnvelope extracts inbox header fields", () => {
  assert.deepEqual(
    parseImapFetchEnvelope(
      '* 42 FETCH (RFC822.SIZE 2048 FLAGS (\\Seen) ENVELOPE ("Mon, 01 Apr 2024 10:00:00 +0000" "Weekly report" (("Jane Sender" NIL "jane" "example.com")) NIL NIL NIL NIL NIL NIL "<message-42@example.com>"))'
    ),
    {
      sequence: 42,
      remoteMessageRef: "<message-42@example.com>",
      subject: "Weekly report",
      fromName: "Jane Sender",
      fromAddress: "jane@example.com",
      date: "Mon, 01 Apr 2024 10:00:00 +0000",
      flags: ["\\Seen"],
      unread: false,
      size: 2048
    }
  );
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
    body: ".leading line",
    inReplyTo: "<original@example.com>",
    references: ["<root@example.com>", "<original@example.com>"]
  });

  assert.match(message, /From: Ops <ops@example.com>/);
  assert.match(message, /In-Reply-To: <original@example.com>/);
  assert.match(message, /References: <root@example.com> <original@example.com>/);
  assert.match(message, /\r\n\.\.leading line$/);
});
