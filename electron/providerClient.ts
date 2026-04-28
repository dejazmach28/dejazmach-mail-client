import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import type { Attachment, SmtpAuthMethod, TransportSecurity } from "../shared/contracts.js";

type SocketLike = net.Socket | tls.TLSSocket;

type AccountConnectionInput = {
  username: string;
  password: string;
  address: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  outgoingServer: string;
  outgoingPort: number;
  outgoingSecurity: TransportSecurity;
  outgoingAuthMethod: SmtpAuthMethod;
};

export type InboxHeader = {
  sequence: number;
  uid: number;
  remoteMessageRef: string;
  inReplyTo: string;
  references: string[];
  subject: string;
  fromName: string;
  fromAddress: string;
  to: string;
  cc: string;
  date: string;
  flags: string[];
  unread: boolean;
  size: number;
  preview: string;
};

export type VerificationSummary = {
  imap: {
    greeting: string;
    messages?: number;
    unseen?: number;
    folders: Array<{
      name: string;
      kind: "inbox" | "drafts" | "sent" | "archive" | "trash" | "custom";
    }>;
    headers: InboxHeader[];
  };
  smtp: {
    secured: boolean;
    authMethod: string;
    error?: string;
  };
};

export type SendMessageInput = {
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  outgoingServer: string;
  outgoingPort: number;
  outgoingSecurity: TransportSecurity;
  outgoingAuthMethod: SmtpAuthMethod;
  to: string;
  cc?: string;
  bcc?: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  inReplyTo?: string;
  references?: string[];
};

export type FetchMessageBodyInput = {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  folderName: string;
  uid: number;
};

export type SyncFolderInput = {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  folderName: string;
  limit?: number;
};

export type FetchedMessageBody = {
  body: string;
  html: string | null;
  attachments: Attachment[];
  to?: string;
  cc?: string;
};

type ImapMessageMutationInput = {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  folderName: string;
  uid: number;
};

type ImapMoveMessageInput = ImapMessageMutationInput & {
  targetFolderName: string;
};

type ImapAppendDraftInput = {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  folderName: string;
  fromAddress: string;
  fromName: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  inReplyTo?: string;
  references?: string[];
};

type Reply = {
  code: number;
  lines: string[];
};

type ImapNode = string | null | ImapNode[];

const TIMEOUT_MS = 15000;
const INVALID_FOLDER_NAMES = new Set(["Folders", "System", "Custom", "All Folders", ""]);

const getErrorCode = (error: unknown) =>
  typeof error === "object" && error && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";

export const describeTransportError = (
  error: unknown,
  protocol: "IMAP" | "SMTP",
  host: string,
  port: number
) => {
  const aggregateErrors =
    typeof error === "object" && error && "errors" in error && Array.isArray((error as { errors?: unknown[] }).errors)
      ? (error as { errors: unknown[] }).errors
      : [];
  const codes = new Set([getErrorCode(error), ...aggregateErrors.map((entry) => getErrorCode(entry))].filter(Boolean));
  const message = error instanceof Error ? error.message : String(error);

  if (codes.has("ETIMEDOUT") || codes.has("ENETUNREACH") || codes.has("EHOSTUNREACH")) {
    return `Could not reach the ${protocol} server at ${host}:${port}. Check the host, port, firewall, and selected security mode.`;
  }

  if (codes.has("ECONNREFUSED")) {
    return `The ${protocol} server at ${host}:${port} refused the connection. Check the port and whether SSL/TLS or STARTTLS matches the provider settings.`;
  }

  if (codes.has("ENOTFOUND")) {
    return `The ${protocol} host ${host} could not be resolved. Check the server name for typos.`;
  }

  if (/AUTH/i.test(message) || /\b535\b/.test(message) || /\b534\b/.test(message)) {
    return `${protocol} authentication failed. Check the username, password or app password, and the selected authentication method.`;
  }

  return message;
};

const withTimeout = async <T>(promise: Promise<T>, label: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms.`)), TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const normalizePlainText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

const parseAddressList = (value: string) =>
  value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const encodeQuotedPrintable = (value: string) =>
  Buffer.from(value, "utf8")
    .reduce((parts: string[], byte) => {
      if ((byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126) || byte === 9 || byte === 32) {
        parts.push(String.fromCharCode(byte));
      } else if (byte === 10) {
        parts.push("\r\n");
      } else if (byte !== 13) {
        parts.push(`=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
      }

      return parts;
    }, [])
    .join("");

const escapeImapString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const assertValidFolderName = (folderName: string) => {
  const normalizedFolderName = folderName.trim();
  if (INVALID_FOLDER_NAMES.has(normalizedFolderName)) {
    throw new Error(`Invalid folder name: "${folderName}" — this is not a real IMAP folder`);
  }

  return normalizedFolderName;
};

export const parseImapStatusLine = (line: string) => {
  const match = /^\* STATUS [^(]+ \((.+)\)$/.exec(line.trim());
  if (!match) {
    return {};
  }

  const tokens = match[1].trim().split(/\s+/);
  const result: Record<string, number> = {};

  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]?.toUpperCase();
    const value = Number(tokens[index + 1]);

    if (key && Number.isFinite(value)) {
      result[key] = value;
    }
  }

  return result;
};

export const parseImapListLine = (line: string) => {
  const match = /^\* LIST \(([^)]*)\)\s+((?:"(?:[^"\\]|\\.)*"|NIL|[^\s]+))\s+(.+)$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const decodeToken = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.toUpperCase() === "NIL") {
      return "";
    }

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }

    return trimmed;
  };

  const attributes = match[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((attribute) => attribute.replace(/^\\/, "").toLowerCase());

  return {
    attributes,
    delimiter: decodeToken(match[2]),
    name: decodeToken(match[3]).replace(/^"(.*)"$/, "$1")
  };
};

const skipWhitespace = (value: string, index: number) => {
  let cursor = index;
  while (cursor < value.length && /\s/.test(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
};

const parseQuotedString = (value: string, start: number) => {
  let cursor = start + 1;
  let result = "";

  while (cursor < value.length) {
    const character = value[cursor] ?? "";
    if (character === "\\") {
      result += value[cursor + 1] ?? "";
      cursor += 2;
      continue;
    }

    if (character === '"') {
      return { node: result, nextIndex: cursor + 1 };
    }

    result += character;
    cursor += 1;
  }

  throw new Error(`Unterminated IMAP quoted string: ${value}`);
};

const parseAtom = (value: string, start: number) => {
  let cursor = start;
  while (cursor < value.length && !/[\s()]/.test(value[cursor] ?? "")) {
    cursor += 1;
  }

  const atom = value.slice(start, cursor);
  return {
    node: atom.toUpperCase() === "NIL" ? null : atom,
    nextIndex: cursor
  };
};

const parseImapNode = (value: string, start = 0): { node: ImapNode; nextIndex: number } => {
  const cursor = skipWhitespace(value, start);
  const character = value[cursor];

  if (!character) {
    throw new Error(`Unexpected end of IMAP value: ${value}`);
  }

  if (character === "(") {
    const nodes: ImapNode[] = [];
    let nextIndex = cursor + 1;

    while (true) {
      nextIndex = skipWhitespace(value, nextIndex);
      if ((value[nextIndex] ?? "") === ")") {
        return { node: nodes, nextIndex: nextIndex + 1 };
      }

      const parsed = parseImapNode(value, nextIndex);
      nodes.push(parsed.node);
      nextIndex = parsed.nextIndex;
    }
  }

  if (character === '"') {
    return parseQuotedString(value, cursor);
  }

  return parseAtom(value, cursor);
};

const asImapList = (value: ImapNode) => (Array.isArray(value) ? value : []);

const asImapString = (value: ImapNode) => (typeof value === "string" ? value : "");

/** Decode an RFC 2047 encoded-word string, e.g. =?UTF-8?B?...?= or =?UTF-8?Q?...?= */
const decodeRfc2047 = (str: string): string => {
  if (!str || !str.includes("=?")) return str;
  return str
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
        }
        if (encoding.toUpperCase() === "Q") {
          const unescaped = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (__, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
          return charset.toLowerCase().replace(/[-_]/g, "").startsWith("utf8")
            ? Buffer.from(unescaped, "latin1").toString("utf8")
            : unescaped;
        }
      } catch {
        // fall through and return original text
      }
      return text;
    })
    .replace(/\?= =\?[^?]+\?[BbQq]\?/g, "")  // join adjacent encoded words
    .trim();
};

/** Format an address list to a comma-separated "Name <addr>" string */
const formatAddressList = (entries: Array<{ name: string; address: string }>) =>
  entries
    .map((e) => (e.name.trim() ? `${e.name} <${e.address}>` : e.address))
    .join(", ");

const parseEnvelopeAddressList = (value: ImapNode) =>
  asImapList(value)
    .map((entry) => asImapList(entry))
    .map((entry) => ({
      name: entry[0] === null ? "" : decodeRfc2047(asImapString(entry[0])),
      mailbox: asImapString(entry[2]),
      host: asImapString(entry[3])
    }))
    .filter((entry) => entry.mailbox && entry.host)
    .map((entry) => ({
      name: entry.name,
      address: `${entry.mailbox}@${entry.host}`
    }));

export const parseImapFetchEnvelope = (line: string): InboxHeader | null => {
  const match = /^\* (\d+) FETCH \((.*)\)$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const sequence = Number(match[1]);
  const parsed = parseImapNode(`(${match[2]})`);
  const tokens = asImapList(parsed.node);

  let uid = 0;
  let size = 0;
  let flags: string[] = [];
  let envelope: ImapNode[] = [];

  for (let index = 0; index < tokens.length; index += 2) {
    const key = asImapString(tokens[index]).toUpperCase();
    const tokenValue = tokens[index + 1];

    if (key === "UID") {
      uid = Number(asImapString(tokenValue)) || 0;
    }

    if (key === "RFC822.SIZE") {
      size = Number(asImapString(tokenValue)) || 0;
    }

    if (key === "FLAGS") {
      flags = asImapList(tokenValue).map((flag) => asImapString(flag));
    }

    if (key === "ENVELOPE") {
      envelope = asImapList(tokenValue);
    }
  }

  const fromEntries = parseEnvelopeAddressList(envelope[2]);
  const fromEntry = fromEntries[0] ?? { name: "", address: "" };
  const toEntries = parseEnvelopeAddressList(envelope[5]);
  const ccEntries = parseEnvelopeAddressList(envelope[6]);
  const subject = decodeRfc2047(asImapString(envelope[1])) || "No subject";
  const date = asImapString(envelope[0]);
  const inReplyTo = asImapString(envelope[8]);
  const messageId = asImapString(envelope[9]);

  return {
    sequence,
    uid,
    remoteMessageRef: messageId || `seq:${sequence}`,
    inReplyTo,
    references: [],
    subject,
    fromName: fromEntry.name,
    fromAddress: fromEntry.address,
    to: formatAddressList(toEntries),
    cc: formatAddressList(ccEntries),
    date,
    flags,
    unread: !flags.some((flag) => flag.toLowerCase() === "\\seen"),
    size,
    preview: ""
  };
};

const looksLikeQuotedPrintable = (value: string) => /=([0-9A-Fa-f]{2}|\r?\n)/.test(value);

const looksLikeBase64 = (value: string) => {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 24 && compact.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(compact);
};

const cleanPreviewText = (value: string) => {
  let preview = value;

  if (looksLikeQuotedPrintable(preview)) {
    preview = decodeQuotedPrintableBuffer(preview).toString("utf8");
  } else if (looksLikeBase64(preview)) {
    try {
      preview = Buffer.from(preview.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      // Keep the raw preview if base64 decode fails.
    }
  }

  return stripHtmlTags(preview)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
};

const parsePreviewFetches = (lines: string[], literals: Buffer[]) => {
  const previews = new Map<number, string>();
  let literalIndex = 0;

  for (const line of lines) {
    const match = /^\* \d+ FETCH \(UID (\d+)\b.*\{(\d+)\}$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const uid = Number(match[1]);
    const literal = literals[literalIndex];
    literalIndex += 1;

    if (!literal || !uid) {
      continue;
    }

    const preview = cleanPreviewText(literal.toString("utf8"));
    previews.set(uid, preview);
  }

  return previews;
};

const parseHeaderReferences = (value: string) => {
  const matches = value.match(/<[^>]+>/g);
  return matches ? Array.from(new Set(matches)) : [];
};

const parseSimpleHeaders = (value: string) => {
  const unfolded = value.replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string>();

  for (const line of unfolded.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    headers.set(
      line.slice(0, separatorIndex).trim().toLowerCase(),
      line.slice(separatorIndex + 1).trim()
    );
  }

  return headers;
};

const parseReferenceFetches = (lines: string[], literals: Buffer[]) => {
  const referencesByUid = new Map<number, { inReplyTo: string; references: string[] }>();
  let literalIndex = 0;

  for (const line of lines) {
    const match = /^\* \d+ FETCH \(UID (\d+)\b.*\{(\d+)\}$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const uid = Number(match[1]);
    const literal = literals[literalIndex];
    literalIndex += 1;

    if (!literal || !uid) {
      continue;
    }

    const headers = parseSimpleHeaders(literal.toString("utf8"));
    const inReplyTo = headers.get("in-reply-to") ?? "";
    const references = parseHeaderReferences(headers.get("references") ?? "");
    referencesByUid.set(uid, {
      inReplyTo: parseHeaderReferences(inReplyTo)[0] ?? inReplyTo,
      references
    });
  }

  return referencesByUid;
};

const parseImapExists = (lines: string[]) => {
  const existsLine = lines.find((line) => /^\* \d+ EXISTS$/.test(line.trim()));
  if (!existsLine) {
    return 0;
  }

  const match = /^\* (\d+) EXISTS$/.exec(existsLine.trim());
  return match ? Number(match[1]) : 0;
};

export const parseSmtpCapabilities = (reply: Reply) =>
  reply.lines
    .slice(1)
    .map((line) => line.replace(/^\d{3}[ -]/, "").trim())
    .filter(Boolean);

const generateBoundary = () =>
  `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const sanitizeOutgoingHtml = (html: string): string =>
  html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "blocked:");

export const buildPlainTextMessage = ({
  fromAddress,
  fromName,
  to,
  cc,
  subject,
  body,
  htmlBody,
  attachments,
  inReplyTo,
  references
}: {
  fromAddress: string;
  fromName: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  inReplyTo?: string;
  references?: string[];
}) => {
  const fromHeader = fromName.trim() ? `${fromName.trim()} <${fromAddress}>` : fromAddress;
  const normalizedReferences = Array.from(new Set((references ?? []).filter(Boolean)));
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@dejazmach.local>`;

  const baseHeaders = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    ...(cc?.trim() ? [`Cc: ${cc.trim()}`] : []),
    `Subject: ${subject || "No subject"}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(normalizedReferences.length > 0 ? [`References: ${normalizedReferences.join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];

  const sanitizedHtmlBody = htmlBody?.trim() ? sanitizeOutgoingHtml(htmlBody) : undefined;
  const normalizedPlainBody = normalizePlainText(
    sanitizedHtmlBody ? stripHtmlTags(sanitizedHtmlBody).trim() || body || "" : body || ""
  );
  const plainEncoded = encodeQuotedPrintable(normalizedPlainBody);
  const hasHtml = Boolean(sanitizedHtmlBody?.trim());
  const hasAttachments = Boolean(attachments?.length);

  // Simple plain text — no HTML, no attachments
  if (!hasHtml && !hasAttachments) {
    return [
      ...baseHeaders,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      plainEncoded
    ].join("\r\n");
  }

  // Build the body part (plain or alternative)
  const buildBodyPart = (): string => {
    if (!hasHtml) {
      return [
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        plainEncoded
      ].join("\r\n");
    }
    const altBoundary = generateBoundary();
    const htmlEncoded = encodeQuotedPrintable(sanitizedHtmlBody!);
    return [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      `--${altBoundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      plainEncoded,
      "",
      `--${altBoundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      htmlEncoded,
      "",
      `--${altBoundary}--`
    ].join("\r\n");
  };

  if (!hasAttachments) {
    return [...baseHeaders, buildBodyPart()].join("\r\n");
  }

  // multipart/mixed: body + attachments
  const mixedBoundary = generateBoundary();
  const lines: string[] = [
    ...baseHeaders,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    buildBodyPart(),
    "",
  ];

  for (const att of attachments!) {
    // Chunk base64 at 76 chars per line (RFC 2045)
    const chunked = att.data.replace(/(.{76})/g, "$1\r\n").trimEnd();
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      chunked,
      ""
    );
  }

  lines.push(`--${mixedBoundary}--`);
  return lines.join("\r\n");
};

class LineSocket {
  private socket: SocketLike;

  private buffer = Buffer.alloc(0);

  private terminalError: Error | null = null;

  private waiters: Array<() => void> = [];

  constructor(socket: SocketLike) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: SocketLike) {
    socket.on("data", this.handleData);
    socket.once("error", this.handleTerminal);
    socket.once("close", () => this.handleTerminal(new Error("Socket closed before protocol completed.")));
    socket.once("end", () => this.handleTerminal(new Error("Socket ended before protocol completed.")));
  }

  private detach(socket: SocketLike) {
    socket.off("data", this.handleData);
  }

  private handleTerminal = (error: Error) => {
    if (this.terminalError) {
      return;
    }

    this.terminalError = error;
    this.flushWaiters();
  };

  private flushWaiters() {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) {
      waiter();
    }
  }

  private handleData = (chunk: string | Buffer) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.buffer = Buffer.concat([this.buffer, data]);
    this.flushWaiters();
  };

  private async waitForBufferedData(label: string) {
    if (this.terminalError) {
      throw this.terminalError;
    }

    await withTimeout(
      new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      }),
      label
    );

    if (this.terminalError && this.buffer.length === 0) {
      throw this.terminalError;
    }
  };

  async readLine() {
    while (true) {
      const newlineIndex = this.buffer.indexOf(0x0a);
      if (newlineIndex !== -1) {
        const rawLine = this.buffer.subarray(0, newlineIndex);
        this.buffer = this.buffer.subarray(newlineIndex + 1);
        return rawLine.toString("utf8").replace(/\r$/, "");
      }

      await this.waitForBufferedData("Protocol read");
    }
  }

  async readBytes(length: number) {
    while (this.buffer.length < length) {
      await this.waitForBufferedData("Protocol literal read");
    }

    const chunk = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return chunk;
  }

  async readReply() {
    const firstLine = await this.readLine();
    const firstMatch = /^(\d{3})([ -])(.*)$/.exec(firstLine);

    if (!firstMatch) {
      throw new Error(`Unexpected SMTP reply: ${firstLine}`);
    }

    const code = Number(firstMatch[1]);
    const lines = [firstLine];
    let separator = firstMatch[2];

    while (separator === "-") {
      const line = await this.readLine();
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match || Number(match[1]) !== code) {
        throw new Error(`Malformed SMTP continuation reply: ${line}`);
      }
      separator = match[2];
    }

    return { code, lines };
  }

  write(line: string) {
    this.socket.write(line, "utf8");
  }

  async upgradeToTls(servername: string) {
    const previousSocket = this.socket;
    this.detach(previousSocket);

    const secureSocket = tls.connect({
      socket: previousSocket as net.Socket,
      servername,
      rejectUnauthorized: true
    });

    await withTimeout(once(secureSocket, "secureConnect").then(() => undefined), "TLS upgrade");
    this.socket = secureSocket;
    this.attach(secureSocket);
  }

  close() {
    this.socket.end();
    this.socket.destroy();
  }
}

const createSecureSocket = async (host: string, port: number) => {
  const socket = tls.connect({
    host,
    port,
    servername: host,
    rejectUnauthorized: true
  });

  await withTimeout(once(socket, "secureConnect").then(() => undefined), `TLS connect to ${host}:${port}`);
  return socket;
};

const createPlainSocket = async (host: string, port: number) => {
  const socket = net.connect({
    host,
    port
  });

  await withTimeout(once(socket, "connect").then(() => undefined), `TCP connect to ${host}:${port}`);
  return socket;
};

const assertSmtpReply = (reply: Reply, expectedCode: number, action: string) => {
  if (reply.code !== expectedCode) {
    throw new Error(`${action} failed with SMTP ${reply.code}: ${reply.lines.join(" | ")}`);
  }
};

const runImapCommand = async (socket: LineSocket, tag: string, command: string) => {
  socket.write(`${tag} ${command}\r\n`);
  const lines: string[] = [];

  while (true) {
    const line = await socket.readLine();
    lines.push(line);
    if (line.startsWith(`${tag} `)) {
      break;
    }
  }

  const finalLine = lines[lines.length - 1] ?? "";
  if (!new RegExp(`^${tag} OK\\b`).test(finalLine)) {
    throw new Error(`IMAP command failed: ${finalLine}`);
  }

  return lines;
};

const runImapLiteralCommand = async (socket: LineSocket, tag: string, command: string) => {
  socket.write(`${tag} ${command}\r\n`);
  const lines: string[] = [];
  const literals: Buffer[] = [];

  while (true) {
    const line = await socket.readLine();
    lines.push(line);

    const literalMatch = /\{(\d+)\}$/.exec(line);
    if (literalMatch) {
      const literalLength = Number(literalMatch[1]);
      const literal = await socket.readBytes(literalLength);
      literals.push(literal);
    }

    if (line.startsWith(`${tag} `)) {
      break;
    }
  }

  const finalLine = lines[lines.length - 1] ?? "";
  if (!new RegExp(`^${tag} OK\\b`).test(finalLine)) {
    throw new Error(`IMAP command failed: ${finalLine}`);
  }

  return { lines, literals };
};

const runImapAppendCommand = async (socket: LineSocket, tag: string, command: string, literal: string) => {
  socket.write(`${tag} ${command} {${Buffer.byteLength(literal, "utf8")}}\r\n`);
  const continuation = await socket.readLine();

  if (!continuation.startsWith("+")) {
    throw new Error(`IMAP APPEND failed: ${continuation}`);
  }

  socket.write(`${literal}\r\n`);
  const lines: string[] = [continuation];

  while (true) {
    const line = await socket.readLine();
    lines.push(line);
    if (line.startsWith(`${tag} `)) {
      break;
    }
  }

  const finalLine = lines[lines.length - 1] ?? "";
  if (!new RegExp(`^${tag} OK\\b`).test(finalLine)) {
    throw new Error(`IMAP APPEND failed: ${finalLine}`);
  }

  return lines;
};

const decodeQuotedPrintableBuffer = (input: string) => {
  const normalized = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    bytes.push(normalized.charCodeAt(index) & 0xff);
  }

  return Buffer.from(bytes);
};

const stripHtmlTags = (value: string) =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const parseMimeHeaders = (value: string) => {
  const unfolded = value.replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string>();

  for (const line of unfolded.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const headerValue = line.slice(separatorIndex + 1).trim();
    headers.set(key, headerValue);
  }

  return headers;
};

const extractBoundary = (contentType: string) => {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  return boundaryMatch?.[1] ?? "";
};

const getMimeCharset = (contentType: string): BufferEncoding => {
  const charsetMatch = /charset="?([^";]+)"?/i.exec(contentType);
  const normalizedCharset = charsetMatch?.[1]?.trim().toLowerCase() ?? "utf-8";

  if (normalizedCharset === "iso-8859-1" || normalizedCharset === "latin1") {
    return "latin1";
  }

  return "utf8";
};

const decodeMimeContentBuffer = (body: string, transferEncoding: string) => {
  const normalizedEncoding = transferEncoding.trim().toLowerCase();

  if (normalizedEncoding === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64");
  }

  if (normalizedEncoding === "quoted-printable") {
    return decodeQuotedPrintableBuffer(body);
  }

  return Buffer.from(body, "latin1");
};

const decodeMimeContent = (body: string, transferEncoding: string, charset: BufferEncoding) => {
  return decodeMimeContentBuffer(body, transferEncoding).toString(charset);
};

const splitMimeMessage = (rawMessage: Buffer) => {
  const crlfSeparator = Buffer.from("\r\n\r\n", "utf8");
  const lfSeparator = Buffer.from("\n\n", "utf8");
  const crlfIndex = rawMessage.indexOf(crlfSeparator);

  if (crlfIndex !== -1) {
    return {
      headerBlock: rawMessage.subarray(0, crlfIndex).toString("latin1"),
      bodyBlock: rawMessage.subarray(crlfIndex + crlfSeparator.length)
    };
  }

  const lfIndex = rawMessage.indexOf(lfSeparator);
  if (lfIndex !== -1) {
    return {
      headerBlock: rawMessage.subarray(0, lfIndex).toString("latin1"),
      bodyBlock: rawMessage.subarray(lfIndex + lfSeparator.length)
    };
  }

  return {
    headerBlock: "",
    bodyBlock: rawMessage
  };
};

export const extractMimeContent = (rawMessage: Buffer): FetchedMessageBody => {
  const { headerBlock, bodyBlock } = splitMimeMessage(rawMessage);
  const headers = parseMimeHeaders(headerBlock);
  const contentType = headers.get("content-type") ?? "text/plain";
  const transferEncoding = headers.get("content-transfer-encoding") ?? "";
  const disposition = headers.get("content-disposition") ?? "";
  const charset = getMimeCharset(contentType);
  const filename =
    /filename\*?="?([^";]+)"?/i.exec(disposition)?.[1] ??
    /name\*?="?([^";]+)"?/i.exec(contentType)?.[1] ??
    "attachment";
  const isTextPart = /text\/plain/i.test(contentType) || /text\/html/i.test(contentType);
  const isAttachment = /attachment/i.test(disposition) || (!isTextPart && !/multipart\//i.test(contentType));

  if (/multipart\//i.test(contentType)) {
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      return {
        body: bodyBlock.toString("utf8").trim(),
        html: null,
        attachments: []
      };
    }

    const parts = bodyBlock
      .toString("latin1")
      .split(`--${boundary}`)
      .map((part) => part.trim())
      .filter((part) => part && part !== "--");
    let plainBody = "";
    let htmlBody: string | null = null;
    const attachments: Attachment[] = [];

    for (const part of parts) {
      const nextPart = extractMimeContent(Buffer.from(part, "latin1"));
      if (!plainBody && nextPart.body) {
        plainBody = nextPart.body;
      }
      if (!htmlBody && nextPart.html) {
        htmlBody = nextPart.html;
      }
      attachments.push(...nextPart.attachments);
    }

    return {
      body: plainBody || stripHtmlTags(htmlBody ?? "").trim(),
      html: htmlBody,
      attachments
    };
  }

  if (isAttachment) {
    const decodedBuffer = decodeMimeContentBuffer(bodyBlock.toString("latin1"), transferEncoding);

    return {
      body: "",
      html: null,
      attachments: [
        {
          filename,
          mimeType: contentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream",
          size: decodedBuffer.byteLength,
          data: decodedBuffer.toString("base64")
        }
      ]
    };
  }

  const decodedBody = decodeMimeContent(bodyBlock.toString("latin1"), transferEncoding, charset).trim();

  if (/text\/html/i.test(contentType)) {
    return {
      body: stripHtmlTags(decodedBody),
      html: decodedBody || null,
      attachments: []
    };
  }

  return {
    body: decodedBody,
    html: null,
    attachments: []
  };
};

const createAuthenticatedImapSocket = async (input: {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
}) => {
  const baseSocket =
    input.incomingSecurity === "ssl_tls"
      ? await createSecureSocket(input.incomingServer, input.incomingPort)
      : await createPlainSocket(input.incomingServer, input.incomingPort);
  const socket = new LineSocket(baseSocket);

  await socket.readLine();

  if (input.incomingSecurity === "starttls") {
    await runImapCommand(socket, "I0000", "STARTTLS");
    await socket.upgradeToTls(input.incomingServer);
  }

  await runImapCommand(
    socket,
    "I0001",
    `LOGIN ${escapeImapString(input.username)} ${escapeImapString(input.password)}`
  );

  return socket;
};

const logoutImapSocket = async (socket: LineSocket, tag: string) => {
  try {
    await runImapCommand(socket, tag, "LOGOUT");
  } finally {
    socket.close();
  }
};

const getImapFetchRange = (exists: number, limit?: number) => {
  if (exists <= 0) {
    return null;
  }

  if (typeof limit === "number" && limit > 0) {
    const headerStart = exists > limit ? exists - (limit - 1) : 1;
    return `${headerStart}:${exists}`;
  }

  if (exists > 500) {
    return `${exists - 499}:${exists}`;
  }

  return "1:*";
};

const fetchSelectedFolderHeaders = async (socket: LineSocket, folderName: string, limit?: number) => {
  const normalizedFolderName = assertValidFolderName(folderName);
  const selectLines = await runImapCommand(socket, "I0002", `SELECT ${escapeImapString(normalizedFolderName)}`);
  const exists = parseImapExists(selectLines);
  const fetchRange = getImapFetchRange(exists, limit);
  const headerLines =
    fetchRange
      ? await runImapCommand(
          socket,
          "I0003",
          `FETCH ${fetchRange} (UID RFC822.SIZE FLAGS ENVELOPE)`
        )
      : [];
  const previewResult =
    fetchRange
      ? await runImapLiteralCommand(
          socket,
          "I0004",
          `FETCH ${fetchRange} (UID BODY.PEEK[TEXT]<0.200>)`
        )
      : { lines: [], literals: [] };
  const referenceResult =
    fetchRange
      ? await runImapLiteralCommand(
          socket,
          "I0005",
          `FETCH ${fetchRange} (UID BODY.PEEK[HEADER.FIELDS (IN-REPLY-TO REFERENCES)])`
        )
      : { lines: [], literals: [] };
  const previewsByUid = parsePreviewFetches(previewResult.lines, previewResult.literals);
  const referencesByUid = parseReferenceFetches(referenceResult.lines, referenceResult.literals);
  const headers = headerLines
    .filter((line) => line.startsWith("* ") && line.includes(" FETCH "))
    .map((line) => parseImapFetchEnvelope(line))
    .filter((header): header is InboxHeader => Boolean(header))
    .map((header) => ({
      ...header,
      inReplyTo: referencesByUid.get(header.uid)?.inReplyTo ?? header.inReplyTo,
      references: referencesByUid.get(header.uid)?.references ?? [],
      preview: previewsByUid.get(header.uid) ?? ""
    }))
    .sort((left, right) => right.sequence - left.sequence);

  return {
    selectLines,
    exists,
    headers
  };
};

const classifyImapFolder = (name: string, attributes: string[]) => {
  const normalizedName = name.toLowerCase();

  if (attributes.includes("inbox") || normalizedName === "inbox") {
    return "inbox" as const;
  }

  if (attributes.includes("drafts") || normalizedName.includes("draft")) {
    return "drafts" as const;
  }

  if (attributes.includes("sent") || normalizedName.includes("sent")) {
    return "sent" as const;
  }

  if (attributes.includes("archive") || normalizedName.includes("archive")) {
    return "archive" as const;
  }

  if (attributes.includes("trash") || normalizedName.includes("trash") || normalizedName.includes("bin")) {
    return "trash" as const;
  }

  if (attributes.includes("junk") || attributes.includes("spam") || normalizedName.includes("junk") || normalizedName.includes("spam")) {
    return "custom" as const;
  }

  return "custom" as const;
};

const authenticateSmtp = async (
  socket: LineSocket,
  capabilities: string[],
  username: string,
  password: string,
  preferredMethod: SmtpAuthMethod
) => {
  const authCapability = capabilities.find((capability) => capability.toUpperCase().startsWith("AUTH "));
  const authValue = authCapability?.toUpperCase() ?? "";

  if (preferredMethod === "none") {
    return "NONE";
  }

  if ((preferredMethod === "auto" || preferredMethod === "plain") && authValue.includes("PLAIN")) {
    const payload = Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
    socket.write(`AUTH PLAIN ${payload}\r\n`);
    const reply = await socket.readReply();
    assertSmtpReply(reply, 235, "SMTP AUTH PLAIN");
    return "PLAIN";
  }

  if ((preferredMethod === "auto" || preferredMethod === "login") && authValue.includes("LOGIN")) {
    socket.write("AUTH LOGIN\r\n");
    let reply = await socket.readReply();
    assertSmtpReply(reply, 334, "SMTP AUTH LOGIN username prompt");

    socket.write(`${Buffer.from(username, "utf8").toString("base64")}\r\n`);
    reply = await socket.readReply();
    assertSmtpReply(reply, 334, "SMTP AUTH LOGIN password prompt");

    socket.write(`${Buffer.from(password, "utf8").toString("base64")}\r\n`);
    reply = await socket.readReply();
    assertSmtpReply(reply, 235, "SMTP AUTH LOGIN");
    return "LOGIN";
  }

  if (preferredMethod === "plain" || preferredMethod === "login") {
    throw new Error(`SMTP server does not advertise the requested AUTH method: ${preferredMethod.toUpperCase()}.`);
  }

  throw new Error("SMTP server does not advertise an AUTH method supported by this client.");
};

const connectImap = async (input: AccountConnectionInput) => {
  const socket = await createAuthenticatedImapSocket({
    username: input.username,
    password: input.password,
    incomingServer: input.incomingServer,
    incomingPort: input.incomingPort,
    incomingSecurity: input.incomingSecurity
  });

  try {
    const greeting = "* OK IMAP connection established";
    const loginLines = ["I0001 OK LOGIN completed"];
    const statusLines = await runImapCommand(socket, "A0002", "STATUS INBOX (MESSAGES UNSEEN)");
    const folderLines = await runImapCommand(socket, "A0003", 'LIST "" "*"');
    console.log("[imap] LIST command sent:", 'LIST "" "*"');
    console.log("[imap] raw LIST response:", folderLines);
    for (const line of folderLines) {
      console.log("[imap] LIST line:", line);
    }
    const { headers } = await fetchSelectedFolderHeaders(socket, "INBOX");
    const statusLine = statusLines.find((line) => line.startsWith("* STATUS"));
    const parsedStatus = statusLine ? parseImapStatusLine(statusLine) : {};
    const folders = folderLines
      .filter((line) => line.startsWith("* LIST"))
      .map((line) => parseImapListLine(line))
      .filter((folder): folder is NonNullable<ReturnType<typeof parseImapListLine>> => Boolean(folder))
      .map((folder) => ({
        name: folder.name,
        kind: classifyImapFolder(folder.name, folder.attributes)
      }));
    console.log(
      "[imap] parsed folders:",
      folders.map((folder) => folder.name)
    );

    return {
      greeting,
      loginLines,
      messages: parsedStatus.MESSAGES,
      unseen: parsedStatus.UNSEEN,
      folders,
      headers
    };
  } finally {
    await logoutImapSocket(socket, "A0006");
  }
};

const connectSmtp = async (input: AccountConnectionInput) => {
  const secureTransport = input.outgoingSecurity === "ssl_tls";
  const baseSocket = secureTransport
    ? await createSecureSocket(input.outgoingServer, input.outgoingPort)
    : await createPlainSocket(input.outgoingServer, input.outgoingPort);

  const socket = new LineSocket(baseSocket);

  try {
    let reply = await socket.readReply();
    assertSmtpReply(reply, 220, "SMTP greeting");

    socket.write("EHLO dejazmach.local\r\n");
    reply = await socket.readReply();
    assertSmtpReply(reply, 250, "SMTP EHLO");

    let capabilities = parseSmtpCapabilities(reply);
    let secured = secureTransport;

    if (
      input.outgoingSecurity === "starttls" &&
      !secured &&
      capabilities.some((capability) => capability.toUpperCase() === "STARTTLS")
    ) {
      socket.write("STARTTLS\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 220, "SMTP STARTTLS");
      await socket.upgradeToTls(input.outgoingServer);
      secured = true;

      socket.write("EHLO dejazmach.local\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 250, "SMTP EHLO after STARTTLS");
      capabilities = parseSmtpCapabilities(reply);
    }

    const authMethod = await authenticateSmtp(
      socket,
      capabilities,
      input.username,
      input.password,
      input.outgoingAuthMethod
    );

    socket.write("QUIT\r\n");
    await socket.readReply();

    return {
      secured,
      authMethod
    };
  } finally {
    socket.close();
  }
};

export const verifyAccountConnection = async (input: AccountConnectionInput): Promise<VerificationSummary> => {
  let imap;
  try {
    imap = await connectImap(input);
  } catch (error) {
    throw new Error(describeTransportError(error, "IMAP", input.incomingServer, input.incomingPort));
  }

  let smtp: VerificationSummary["smtp"];
  try {
    smtp = await connectSmtp(input);
  } catch (error) {
    smtp = {
      secured: false,
      authMethod: "unverified",
      error: describeTransportError(error, "SMTP", input.outgoingServer, input.outgoingPort)
    };
  }

  return {
    imap: {
      greeting: imap.greeting,
      messages: imap.messages,
      unseen: imap.unseen,
      folders: imap.folders,
      headers: imap.headers
    },
    smtp
  };
};

export const fetchImapFolderHeaders = async (input: SyncFolderInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    const { selectLines, headers } = await fetchSelectedFolderHeaders(socket, folderName, input.limit);
    const existsLine = selectLines.find((line) => /^\* \d+ EXISTS$/.test(line.trim()));
    const unseenLine = selectLines.find((line) => /^\* OK \[UNSEEN \d+\]/.test(line.trim()));

    return {
      exists: existsLine ? Number((/^\* (\d+) EXISTS$/.exec(existsLine.trim())?.[1] ?? "0")) : 0,
      unseen: unseenLine ? Number((/\[UNSEEN (\d+)\]/.exec(unseenLine)?.[1] ?? "0")) : 0,
      headers
    };
  } finally {
    await logoutImapSocket(socket, "F0009");
  }
};

export const fetchImapMessageBody = async (input: FetchMessageBodyInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "B0002", `SELECT ${escapeImapString(folderName)}`);
    const bodyResult = await runImapLiteralCommand(socket, "B0003", `UID FETCH ${input.uid} BODY.PEEK[]`);
    const messageLiteral = bodyResult.literals[0];
    if (!messageLiteral || messageLiteral.length === 0) {
      throw new Error(`The IMAP server returned no body data for UID ${input.uid}.`);
    }

    const content = extractMimeContent(messageLiteral);
    // Extract top-level To/CC headers from the raw message for the reader pane
    const { headerBlock } = splitMimeMessage(messageLiteral);
    const topHeaders = parseMimeHeaders(headerBlock);
    return {
      ...content,
      to: decodeRfc2047(topHeaders.get("to") ?? ""),
      cc: decodeRfc2047(topHeaders.get("cc") ?? "")
    };
  } finally {
    await logoutImapSocket(socket, "B0004");
  }
};

export const markImapMessageRead = async (input: ImapMessageMutationInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "M0002", `SELECT ${escapeImapString(folderName)}`);
    await runImapCommand(socket, "M0003", `UID STORE ${input.uid} +FLAGS.SILENT (\\Seen)`);
  } finally {
    await logoutImapSocket(socket, "M0004");
  }
};

export const markImapMessageUnread = async (input: ImapMessageMutationInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "U0002", `SELECT ${escapeImapString(folderName)}`);
    await runImapCommand(socket, "U0003", `UID STORE ${input.uid} -FLAGS.SILENT (\\Seen)`);
  } finally {
    await logoutImapSocket(socket, "U0004");
  }
};

export const toggleImapMessageFlag = async (input: ImapMessageMutationInput & { flagged: boolean }) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "G0002", `SELECT ${escapeImapString(folderName)}`);
    await runImapCommand(
      socket,
      "G0003",
      `UID STORE ${input.uid} ${input.flagged ? "+" : "-"}FLAGS.SILENT (\\Flagged)`
    );
  } finally {
    await logoutImapSocket(socket, "G0004");
  }
};

export const deleteImapMessage = async (input: ImapMessageMutationInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "D0002", `SELECT ${escapeImapString(folderName)}`);
    await runImapCommand(socket, "D0003", `UID STORE ${input.uid} +FLAGS.SILENT (\\Deleted)`);
    await runImapCommand(socket, "D0004", "EXPUNGE");
  } finally {
    await logoutImapSocket(socket, "D0005");
  }
};

export const moveImapMessage = async (input: ImapMoveMessageInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    await runImapCommand(socket, "V0002", `SELECT ${escapeImapString(folderName)}`);
    await runImapCommand(
      socket,
      "V0003",
      `UID COPY ${input.uid} ${escapeImapString(input.targetFolderName)}`
    );
    await runImapCommand(socket, "V0004", `UID STORE ${input.uid} +FLAGS.SILENT (\\Deleted)`);
    await runImapCommand(socket, "V0005", "EXPUNGE");
  } finally {
    await logoutImapSocket(socket, "V0006");
  }
};

export const appendImapDraftMessage = async (input: ImapAppendDraftInput) => {
  const folderName = assertValidFolderName(input.folderName);
  const socket = await createAuthenticatedImapSocket(input);

  try {
    const message = buildPlainTextMessage({
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: input.body,
      htmlBody: input.htmlBody,
      attachments: input.attachments,
      inReplyTo: input.inReplyTo,
      references: input.references
    });

    await runImapAppendCommand(socket, "AP0002", `APPEND ${escapeImapString(folderName)}`, message);
  } finally {
    await logoutImapSocket(socket, "AP0003");
  }
};

export const sendPlainTextMessage = async (input: SendMessageInput) => {
  let socket: LineSocket | null = null;

  try {
    const secureTransport = input.outgoingSecurity === "ssl_tls";
    const baseSocket = secureTransport
      ? await createSecureSocket(input.outgoingServer, input.outgoingPort)
      : await createPlainSocket(input.outgoingServer, input.outgoingPort);

    socket = new LineSocket(baseSocket);

    let reply = await socket.readReply();
    assertSmtpReply(reply, 220, "SMTP greeting");

    socket.write("EHLO dejazmach.local\r\n");
    reply = await socket.readReply();
    assertSmtpReply(reply, 250, "SMTP EHLO");

    let capabilities = parseSmtpCapabilities(reply);
    if (
      input.outgoingSecurity === "starttls" &&
      !secureTransport &&
      capabilities.some((capability) => capability.toUpperCase() === "STARTTLS")
    ) {
      socket.write("STARTTLS\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 220, "SMTP STARTTLS");
      await socket.upgradeToTls(input.outgoingServer);

      socket.write("EHLO dejazmach.local\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 250, "SMTP EHLO after STARTTLS");
      capabilities = parseSmtpCapabilities(reply);
    }

    await authenticateSmtp(socket, capabilities, input.username, input.password, input.outgoingAuthMethod);

    socket.write(`MAIL FROM:<${input.fromAddress}>\r\n`);
    reply = await socket.readReply();
    assertSmtpReply(reply, 250, "SMTP MAIL FROM");

    for (const recipient of [
      ...parseAddressList(input.to),
      ...parseAddressList(input.cc ?? ""),
      ...(input.bcc ?? [])
    ]) {
      socket.write(`RCPT TO:<${recipient}>\r\n`);
      reply = await socket.readReply();
      assertSmtpReply(reply, 250, "SMTP RCPT TO");
    }

    socket.write("DATA\r\n");
    reply = await socket.readReply();
    assertSmtpReply(reply, 354, "SMTP DATA");

    socket.write(`${buildPlainTextMessage(input)}\r\n.\r\n`);
    reply = await socket.readReply();
    assertSmtpReply(reply, 250, "SMTP message submit");

    socket.write("QUIT\r\n");
    await socket.readReply();
  } catch (error) {
    throw new Error(describeTransportError(error, "SMTP", input.outgoingServer, input.outgoingPort));
  } finally {
    socket?.close();
  }
};
