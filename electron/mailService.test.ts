import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MailService } from "./mailService.js";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "dejazmach-mail-service-"));

const mockCipher = {
  isAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8").replace(/^enc:/, "")
};

const fallbackCipher = {
  isAvailable: () => false,
  encryptString: (_value: string) => {
    throw new Error("safeStorage unavailable");
  },
  decryptString: (_value: Buffer) => null
};

test("mail service starts with an empty account workspace and reference folders", () => {
  const userDataPath = createTempDir();
  const service = new MailService({ userDataPath, cipher: mockCipher });

  const snapshot = service.getWorkspaceSnapshot({
    version: "1.0.0",
    platform: "linux",
    environment: "production",
    packaged: true
  });

  assert.equal(snapshot.accounts.length, 0);
  assert.equal(snapshot.folders.length, 0);
  assert.equal(snapshot.messages.length, 0);
  assert.equal(snapshot.shellState.securityMetrics.some((metric) => metric.label === "Local persistence"), true);

  service.close();
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test("mail service persists added accounts and drafts", async () => {
  const userDataPath = createTempDir();
  const service = new MailService({ userDataPath, cipher: mockCipher });

  const afterAccount = service.createAccount(
    {
      name: "Field Office",
      address: "field@dejazmach.app",
      provider: "IMAP",
      username: "field@dejazmach.app",
      password: "super-secret",
      incomingServer: "imap.example.com",
      incomingPort: 993,
      incomingSecurity: "ssl_tls",
      outgoingServer: "smtp.example.com",
      outgoingPort: 465,
      outgoingSecurity: "ssl_tls",
      outgoingAuthMethod: "auto"
    },
    {
      version: "1.0.0",
      platform: "linux",
      environment: "production",
      packaged: true
    }
  );

  const newAccount = afterAccount.accounts.find((account) => account.address === "field@dejazmach.app");
  assert.ok(newAccount);

  const afterDraft = await service.createDraft(
    {
      accountId: newAccount.id,
      to: "ops@dejazmach.app",
      subject: "Offline report",
      body: "Local draft body"
    },
    {
      version: "1.0.0",
      platform: "linux",
      environment: "production",
      packaged: true
    }
  );

  assert.equal(afterDraft.messages.some((message) => message.subject === "Offline report"), true);
  assert.equal(
    afterDraft.folders.some(
      (folder) => folder.accountId === newAccount.id && folder.kind === "drafts"
    ),
    true
  );

  service.close();
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test("mail service stores account passwords in fallback storage when OS vault is unavailable", () => {
  const userDataPath = createTempDir();
  const service = new MailService({ userDataPath, cipher: fallbackCipher });

  const snapshot = service.createAccount(
    {
      name: "Fallback",
      address: "fallback@dejazmach.app",
      provider: "IMAP",
      username: "fallback@dejazmach.app",
      password: "fallback-secret",
      incomingServer: "imap.example.com",
      incomingPort: 993,
      incomingSecurity: "ssl_tls",
      outgoingServer: "smtp.example.com",
      outgoingPort: 465,
      outgoingSecurity: "ssl_tls",
      outgoingAuthMethod: "auto"
    },
    {
      version: "1.0.0",
      platform: "linux",
      environment: "production",
      packaged: true
    }
  );

  const account = snapshot.accounts.find((entry) => entry.address === "fallback@dejazmach.app");
  assert.ok(account);
  assert.equal(account.storage, "Local fallback");

  const authenticated = (service as unknown as { requireAuthenticatedAccount: (accountId: string) => { password: string } }).requireAuthenticatedAccount(account.id);
  assert.equal(authenticated.password, "fallback-secret");

  service.close();
  fs.rmSync(userDataPath, { recursive: true, force: true });
});
