import electron from "electron";

const { app, safeStorage } = electron;

export type Cipher = {
  isAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string | null;
};

const assertVaultReady = () => {
  if (!app.isReady()) {
    throw new Error("vault called before app ready");
  }
};

export const createCipher = (): Cipher => ({
  isAvailable: () => {
    assertVaultReady();
    return safeStorage.isEncryptionAvailable();
  },
  encryptString: (value: string) => {
    assertVaultReady();
    return safeStorage.encryptString(value);
  },
  decryptString: (value: Buffer) => {
    assertVaultReady();

    try {
      return safeStorage.decryptString(value);
    } catch (error) {
      console.warn(
        "safeStorage decryption failed — credential may have been encrypted under a different app name. Clearing stored credential.",
        error
      );
      return null;
    }
  }
});
