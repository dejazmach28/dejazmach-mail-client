import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlainTextMessage,
  extractMimeContent,
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

test("parseImapListLine handles nil delimiters and nested folder names", () => {
  assert.deepEqual(parseImapListLine('* LIST (\\HasChildren) NIL "Projects/2026/Q2"'), {
    attributes: ["haschildren"],
    delimiter: "",
    name: "Projects/2026/Q2"
  });
});

test("parseImapFetchEnvelope extracts inbox header fields", () => {
  assert.deepEqual(
    parseImapFetchEnvelope(
      '* 42 FETCH (UID 2042 RFC822.SIZE 2048 FLAGS (\\Seen) ENVELOPE ("Mon, 01 Apr 2024 10:00:00 +0000" "Weekly report" (("Jane Sender" NIL "jane" "example.com")) NIL NIL NIL NIL NIL NIL "<message-42@example.com>"))'
    ),
    {
      sequence: 42,
      uid: 2042,
      remoteMessageRef: "<message-42@example.com>",
      inReplyTo: "",
      references: [],
      subject: "Weekly report",
      fromName: "Jane Sender",
      fromAddress: "jane@example.com",
      to: "",
      cc: "",
      date: "Mon, 01 Apr 2024 10:00:00 +0000",
      flags: ["\\Seen"],
      unread: false,
      size: 2048,
      preview: ""
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

test("extractMimeContent decodes multipart html and quoted-printable utf-8 text", () => {
  const rawMessage = Buffer.from(
    [
      'Content-Type: multipart/alternative; boundary="mix"',
      "",
      "--mix",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hello =C2=A0world",
      "--mix",
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<p>Hello =C2=A0<strong>world</strong></p>",
      "--mix--"
    ].join("\r\n"),
    "utf8"
  );

  assert.deepEqual(extractMimeContent(rawMessage), {
    body: "Hello \u00a0world",
    html: "<p>Hello \u00a0<strong>world</strong></p>",
    attachments: []
  });
});

test("extractMimeContent respects latin1 charset for plain text bodies", () => {
  const rawMessage = Buffer.concat([
    Buffer.from('Content-Type: text/plain; charset="iso-8859-1"\r\n\r\n', "utf8"),
    Buffer.from([0x4f, 0x6c, 0xe1])
  ]);

  assert.deepEqual(extractMimeContent(rawMessage), {
    body: "Olá",
    html: null,
    attachments: []
  });
});
