import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";

type SocketLike = net.Socket | tls.TLSSocket;

type AccountConnectionInput = {
  username: string;
  password: string;
  address: string;
  incomingServer: string;
  incomingPort: number;
  outgoingServer: string;
  outgoingPort: number;
};

export type VerificationSummary = {
  imap: {
    greeting: string;
    messages?: number;
    unseen?: number;
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
  to: string;
  subject: string;
  body: string;
};

type Reply = {
  code: number;
  lines: string[];
};

const TIMEOUT_MS = 15000;

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

  private buffer = "";

  private lineQueue: string[] = [];

  private lineResolvers: Array<(line: string) => void> = [];

  private terminalError: Error | null = null;

  constructor(socket: SocketLike) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: SocketLike) {
    socket.setEncoding("utf8");
    socket.on("data", this.handleData);
    socket.once("error", this.handleTerminal);
    socket.once("close", () => this.handleTerminal(new Error("Socket closed before protocol completed.")));
    socket.once("end", () => this.handleTerminal(new Error("Socket ended before protocol completed.")));
  }

  private detach(socket: SocketLike) {
    socket.off("data", this.handleData);
  }

  private handleTerminal = (error: Error) => {
    this.terminalError = error;
    while (this.lineResolvers.length > 0) {
      const resolver = this.lineResolvers.shift();
      if (resolver) {
        resolver("");
      }
    }
  };

  private handleData = (chunk: string | Buffer) => {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    while (this.buffer.includes("\n")) {
      const newlineIndex = this.buffer.indexOf("\n");
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");

      const resolver = this.lineResolvers.shift();
      if (resolver) {
        resolver(line);
      } else {
        this.lineQueue.push(line);
      }
    }
  };

  async readLine() {
    if (this.lineQueue.length > 0) {
      return this.lineQueue.shift() ?? "";
    }

    if (this.terminalError) {
      throw this.terminalError;
    }

    return withTimeout(
      new Promise<string>((resolve) => {
        this.lineResolvers.push(resolve);
      }).then((line) => {
        if (!line && this.terminalError) {
          throw this.terminalError;
        }

        return line;
      }),
      "Protocol read"
    );
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

const authenticateSmtp = async (socket: LineSocket, capabilities: string[], username: string, password: string) => {
  const authCapability = capabilities.find((capability) => capability.toUpperCase().startsWith("AUTH "));
  const authValue = authCapability?.toUpperCase() ?? "";

  if (authValue.includes("PLAIN")) {
    const payload = Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
    socket.write(`AUTH PLAIN ${payload}\r\n`);
    const reply = await socket.readReply();
    assertSmtpReply(reply, 235, "SMTP AUTH PLAIN");
    return "PLAIN";
  }

  if (authValue.includes("LOGIN")) {
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

  throw new Error("SMTP server does not advertise an AUTH method supported by this client.");
};

const connectImap = async (input: AccountConnectionInput) => {
  const secureSocket = await createSecureSocket(input.incomingServer, input.incomingPort);
  const socket = new LineSocket(secureSocket);

  try {
    const greeting = await socket.readLine();
    const loginLines = await runImapCommand(
      socket,
      "A0001",
      `LOGIN ${escapeImapString(input.username)} ${escapeImapString(input.password)}`
    );
    const statusLines = await runImapCommand(socket, "A0002", "STATUS INBOX (MESSAGES UNSEEN)");
    await runImapCommand(socket, "A0003", "LOGOUT");

    const statusLine = statusLines.find((line) => line.startsWith("* STATUS"));
    const parsedStatus = statusLine ? parseImapStatusLine(statusLine) : {};

    return {
      greeting,
      loginLines,
      messages: parsedStatus.MESSAGES,
      unseen: parsedStatus.UNSEEN
    };
  } finally {
    socket.close();
  }
};

const connectSmtp = async (input: AccountConnectionInput) => {
  const secureTransport = input.outgoingPort === 465;
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

    if (!secured && capabilities.some((capability) => capability.toUpperCase() === "STARTTLS")) {
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

    const authMethod = await authenticateSmtp(socket, capabilities, input.username, input.password);

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
  const imap = await connectImap(input);
  const smtp = await connectSmtp(input);

  return {
    imap: {
      greeting: imap.greeting,
      messages: imap.messages,
      unseen: imap.unseen
    },
    smtp
  };
};

export const sendPlainTextMessage = async (input: SendMessageInput) => {
  const secureTransport = input.outgoingPort === 465;
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
    if (!secureTransport && capabilities.some((capability) => capability.toUpperCase() === "STARTTLS")) {
      socket.write("STARTTLS\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 220, "SMTP STARTTLS");
      await socket.upgradeToTls(input.outgoingServer);

      socket.write("EHLO dejazmach.local\r\n");
      reply = await socket.readReply();
      assertSmtpReply(reply, 250, "SMTP EHLO after STARTTLS");
      capabilities = parseSmtpCapabilities(reply);
    }

    await authenticateSmtp(socket, capabilities, input.username, input.password);

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
  } finally {
    socket.close();
  }
};
