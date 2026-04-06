import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import type { SmtpAuthMethod, TransportSecurity } from "../shared/contracts.js";

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
  remoteMessageRef: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  date: string;
  flags: string[];
  unread: boolean;
  size: number;
};

export type VerificationSummary = {
  imap: {
    greeting: string;
    messages?: number;
    unseen?: number;
    folders: Array<{
      name: string;
      kind: "inbox" | "drafts" | "sent" | "archive" | "custom";
    }>;
    headers: InboxHeader[];
  };
  smtp: {
    secured: boolean;
    authMethod: string;
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
  subject: string;
  body: string;
};

export type FetchMessageBodyInput = {
  username: string;
  password: string;
  incomingServer: string;
  incomingPort: number;
  incomingSecurity: TransportSecurity;
  folderName: string;
  sequence: number;
};

type Reply = {
  code: number;
  lines: string[];
};

type ImapNode = string | null | ImapNode[];

const TIMEOUT_MS = 15000;

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

const escapeImapString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

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
  const match = /^\* LIST \(([^)]*)\) "(.*)" "?(.+?)"?$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const attributes = match[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((attribute) => attribute.replace(/^\\/, "").toLowerCase());

  return {
    attributes,
    delimiter: match[2],
    name: match[3]
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

const parseEnvelopeAddressList = (value: ImapNode) =>
  asImapList(value)
    .map((entry) => asImapList(entry))
    .map((entry) => ({
      name: entry[0] === null ? "" : asImapString(entry[0]),
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

  let size = 0;
  let flags: string[] = [];
  let envelope: ImapNode[] = [];

  for (let index = 0; index < tokens.length; index += 2) {
    const key = asImapString(tokens[index]).toUpperCase();
    const tokenValue = tokens[index + 1];

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
  const subject = asImapString(envelope[1]) || "No subject";
  const date = asImapString(envelope[0]);
  const messageId = asImapString(envelope[9]);

  return {
    sequence,
    remoteMessageRef: messageId || `seq:${sequence}`,
    subject,
    fromName: fromEntry.name,
    fromAddress: fromEntry.address,
    date,
    flags,
    unread: !flags.some((flag) => flag.toLowerCase() === "\\seen"),
    size
  };
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

export const buildPlainTextMessage = ({
  fromAddress,
  fromName,
  to,
  subject,
  body
}: {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
}) => {
  const fromHeader = fromName.trim() ? `${fromName.trim()} <${fromAddress}>` : fromAddress;

  return [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject || "No subject"}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizePlainText(body || "")
  ].join("\r\n");
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
  const literals: string[] = [];

  while (true) {
    const line = await socket.readLine();
    lines.push(line);

    const literalMatch = /\{(\d+)\}$/.exec(line);
    if (literalMatch) {
      const literalLength = Number(literalMatch[1]);
      const literal = await socket.readBytes(literalLength);
      literals.push(literal.toString("utf8"));
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
  const baseSocket =
    input.incomingSecurity === "ssl_tls"
      ? await createSecureSocket(input.incomingServer, input.incomingPort)
      : await createPlainSocket(input.incomingServer, input.incomingPort);
  const socket = new LineSocket(baseSocket);

  try {
    const greeting = await socket.readLine();

    if (input.incomingSecurity === "starttls") {
      await runImapCommand(socket, "A0000", "STARTTLS");
      await socket.upgradeToTls(input.incomingServer);
    }

    const loginLines = await runImapCommand(
      socket,
      "A0001",
      `LOGIN ${escapeImapString(input.username)} ${escapeImapString(input.password)}`
    );
    const statusLines = await runImapCommand(socket, "A0002", "STATUS INBOX (MESSAGES UNSEEN)");
    const folderLines = await runImapCommand(socket, "A0003", 'LIST "" "*"');
    const selectLines = await runImapCommand(socket, "A0004", "SELECT INBOX");
    const exists = parseImapExists(selectLines);
    const headerStart = exists > 50 ? exists - 49 : 1;
    const headerLines =
      exists > 0
        ? await runImapCommand(
            socket,
            "A0005",
            `FETCH ${headerStart}:${exists} (RFC822.SIZE FLAGS ENVELOPE)`
          )
        : [];
    await runImapCommand(socket, "A0006", "LOGOUT");

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
    const headers = headerLines
      .filter((line) => line.startsWith("* ") && line.includes(" FETCH "))
      .map((line) => parseImapFetchEnvelope(line))
      .filter((header): header is InboxHeader => Boolean(header))
      .sort((left, right) => right.sequence - left.sequence);

    return {
      greeting,
      loginLines,
      messages: parsedStatus.MESSAGES,
      unseen: parsedStatus.UNSEEN,
      folders,
      headers
    };
  } finally {
    socket.close();
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

  let smtp;
  try {
    smtp = await connectSmtp(input);
  } catch (error) {
    throw new Error(describeTransportError(error, "SMTP", input.outgoingServer, input.outgoingPort));
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

export const fetchImapMessageBody = async (input: FetchMessageBodyInput) => {
  const baseSocket =
    input.incomingSecurity === "ssl_tls"
      ? await createSecureSocket(input.incomingServer, input.incomingPort)
      : await createPlainSocket(input.incomingServer, input.incomingPort);
  const socket = new LineSocket(baseSocket);

  try {
    await socket.readLine();

    if (input.incomingSecurity === "starttls") {
      await runImapCommand(socket, "B0000", "STARTTLS");
      await socket.upgradeToTls(input.incomingServer);
    }

    await runImapCommand(
      socket,
      "B0001",
      `LOGIN ${escapeImapString(input.username)} ${escapeImapString(input.password)}`
    );
    await runImapCommand(socket, "B0002", `SELECT ${escapeImapString(input.folderName)}`);
    const bodyResult = await runImapLiteralCommand(socket, "B0003", `FETCH ${input.sequence} RFC822`);
    await runImapCommand(socket, "B0004", "LOGOUT");

    const body = bodyResult.literals[0] ?? "";
    if (!body) {
      throw new Error(`The IMAP server returned no body data for sequence ${input.sequence}.`);
    }

    return body;
  } finally {
    socket.close();
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

    socket.write(`RCPT TO:<${input.to}>\r\n`);
    reply = await socket.readReply();
    assertSmtpReply(reply, 250, "SMTP RCPT TO");

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
