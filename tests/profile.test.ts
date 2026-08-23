import { describe, expect, it } from "vitest";
import {
  createDataProfile,
  createEmptyProfileVault,
  decryptProfileVault,
  encryptProfileVault,
  parseEncryptedProfileBundle,
  profileMetadata,
  serializeEncryptedProfileBundle,
  type ProfileVault,
} from "../src/shared/profile";

function sampleVault(): ProfileVault {
  const profile = createDataProfile(
    "Организация",
    [
      { key: "company", label: "Организация", value: "ООО Секретный пример" },
      { key: "phone", label: "Телефон", value: "+79991234567" },
      { key: "employees", label: "Сотрудников", value: 42 },
    ],
    1_000,
    "profile-org",
  );
  return {
    ...createEmptyProfileVault(1_000),
    profiles: [profile],
  };
}

describe("encrypted local profile vault", () => {
  it("round-trips AES-GCM encrypted profiles without plaintext in the bundle", async () => {
    const vault = sampleVault();
    const encrypted = await encryptProfileVault(vault, "9347", 2_000);
    const serialized = serializeEncryptedProfileBundle(encrypted);

    expect(serialized).not.toContain("ООО Секретный пример");
    expect(serialized).not.toContain("+79991234567");
    expect(serialized).not.toContain("9347");
    expect(encrypted.kdf.iterations).toBeGreaterThanOrEqual(100_000);
    expect(encrypted.iv).not.toBe("");
    expect(encrypted.checksum).toMatch(/^[0-9a-f]{64}$/);

    const opened = await decryptProfileVault(parseEncryptedProfileBundle(serialized), "9347");
    expect(opened).toEqual(vault);
  });

  it("rejects a wrong secret", async () => {
    const encrypted = await encryptProfileVault(sampleVault(), "correct-passphrase", 2_000);
    await expect(decryptProfileVault(encrypted, "wrong-passphrase")).rejects.toThrow("неверный код/пароль");
  });

  it("rejects ciphertext tampering before decryption", async () => {
    const encrypted = await encryptProfileVault(sampleVault(), "9347", 2_000);
    const mutated = encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.endsWith("AA") ? "AQ" : "AA");
    const tampered = { ...encrypted, ciphertext: mutated };

    await expect(decryptProfileVault(tampered, "9347")).rejects.toThrow(/Контрольная сумма|Повреждён/);
  });

  it("exports metadata without profile values", () => {
    const metadata = profileMetadata(sampleVault());
    expect(metadata).toEqual([
      {
        id: "profile-org",
        name: "Организация",
        fieldCount: 3,
        updatedAt: new Date(1_000).toISOString(),
      },
    ]);
    expect(JSON.stringify(metadata)).not.toContain("ООО Секретный пример");
  });

  it("does not accept secrets shorter than four characters", async () => {
    await expect(encryptProfileVault(sampleVault(), "123", 2_000)).rejects.toThrow("минимум 4");
  });
});
