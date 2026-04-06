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

test("mail service seeds a persistent workspace snapshot", () => {
  const userDataPath = createTempDir();
  const service = new MailService({ userDataPath, cipher: mockCipher });

  const snapshot = service.getWorkspaceSnapshot({
    version: "1.0.0",
    platform: "linux",
    environment: "production",
    packaged: true
  });

  assert.equal(snapshot.accounts.length >= 3, true);
  assert.equal(snapshot.folders.some((folder) => folder.id === "folder-drafts"), true);
  assert.equal(snapshot.shellState.securityMetrics.some((metric) => metric.label === "Local persistence"), true);

  service.close();
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test("mail service persists added accounts and drafts", () => {
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
      outgoingServer: "smtp.example.com",
      outgoingPort: 465
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

  const afterDraft = service.createDraft(
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
  assert.equal(afterDraft.folders.some((folder) => folder.id === "folder-drafts" && folder.count > 0), true);

  service.close();
  fs.rmSync(userDataPath, { recursive: true, force: true });
});
