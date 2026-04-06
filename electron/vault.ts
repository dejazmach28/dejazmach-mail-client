import { safeStorage } from "electron";

export type Cipher = {
  isAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

export const createCipher = (): Cipher => ({
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value: string) => safeStorage.encryptString(value),
  decryptString: (value: Buffer) => safeStorage.decryptString(value)
});
