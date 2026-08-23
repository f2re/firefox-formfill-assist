export const PROFILE_VAULT_VERSION = 1;
export const PROFILE_PBKDF2_ITERATIONS = 310_000;
const PROFILE_AAD = "FirefoxFormFillAssistant:ProfileVault:v1";

export type ProfilePrimitive = string | number | boolean | null;

export interface ProfileField {
  key: string;
  label: string;
  value: ProfilePrimitive;
}

export interface DataProfile {
  id: string;
  name: string;
  fields: ProfileField[];
  updatedAt: string;
}

export interface ProfileVault {
  version: 1;
  updatedAt: string;
  profiles: DataProfile[];
}

export interface EncryptedProfileBundle {
  version: 1;
  kind: "formfill-profile-vault";
  cipher: "AES-GCM";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
  checksum: string;
  createdAt: string;
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto API недоступен.");
  return globalThis.crypto;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function utf8(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error("Повреждён base64 в зашифрованном профиле.");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function stableProfileVault(vault: ProfileVault): string {
  return JSON.stringify({
    version: vault.version,
    updatedAt: vault.updatedAt,
    profiles: vault.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      updatedAt: profile.updatedAt,
      fields: profile.fields.map((field) => ({ key: field.key, label: field.label, value: field.value })),
    })),
  });
}

function validateProfileVault(value: unknown): ProfileVault {
  if (!value || typeof value !== "object") throw new Error("Профиль имеет неверный формат.");
  const vault = value as Partial<ProfileVault>;
  if (vault.version !== 1 || typeof vault.updatedAt !== "string" || !Array.isArray(vault.profiles)) {
    throw new Error("Неподдерживаемая версия профиля.");
  }

  const profiles: DataProfile[] = vault.profiles.map((rawProfile) => {
    if (!rawProfile || typeof rawProfile !== "object") throw new Error("Повреждён профиль данных.");
    const profile = rawProfile as Partial<DataProfile>;
    if (
      typeof profile.id !== "string" ||
      !profile.id ||
      typeof profile.name !== "string" ||
      !profile.name.trim() ||
      typeof profile.updatedAt !== "string" ||
      !Array.isArray(profile.fields)
    ) {
      throw new Error("Повреждён профиль данных.");
    }

    const fields: ProfileField[] = profile.fields.map((rawField) => {
      if (!rawField || typeof rawField !== "object") throw new Error("Повреждено поле профиля.");
      const field = rawField as Partial<ProfileField>;
      if (typeof field.key !== "string" || !field.key || typeof field.label !== "string" || !field.label.trim()) {
        throw new Error("Повреждено поле профиля.");
      }
      if (!["string", "number", "boolean"].includes(typeof field.value) && field.value !== null) {
        throw new Error("Неподдерживаемый тип значения в профиле.");
      }
      return { key: field.key, label: field.label, value: field.value as ProfilePrimitive };
    });

    return {
      id: profile.id,
      name: profile.name,
      updatedAt: profile.updatedAt,
      fields,
    };
  });

  return { version: 1, updatedAt: vault.updatedAt, profiles };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await requireCrypto().subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

async function deriveProfileKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (secret.length < 4) throw new Error("Код/пароль профиля должен содержать минимум 4 символа.");
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    throw new Error("Некорректные параметры PBKDF2.");
  }

  const cryptoObject = requireCrypto();
  const baseKey = await cryptoObject.subtle.importKey(
    "raw",
    utf8(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoObject.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function createEmptyProfileVault(now = Date.now()): ProfileVault {
  return { version: 1, updatedAt: new Date(now).toISOString(), profiles: [] };
}

export function createDataProfile(
  name: string,
  fields: ProfileField[] = [],
  now = Date.now(),
  id: string = globalThis.crypto?.randomUUID?.() ?? `profile-${now.toString(36)}`,
): DataProfile {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Название профиля не может быть пустым.");
  return {
    id,
    name: trimmedName,
    updatedAt: new Date(now).toISOString(),
    fields: fields.map((field) => ({ ...field })),
  };
}

export function profileMetadata(vault: ProfileVault): Array<{ id: string; name: string; fieldCount: number; updatedAt: string }> {
  return vault.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    fieldCount: profile.fields.length,
    updatedAt: profile.updatedAt,
  }));
}

export async function encryptProfileVault(
  input: ProfileVault,
  secret: string,
  now = Date.now(),
): Promise<EncryptedProfileBundle> {
  const vault = validateProfileVault(input);
  const cryptoObject = requireCrypto();
  const salt = cryptoObject.getRandomValues(new Uint8Array(16));
  const iv = cryptoObject.getRandomValues(new Uint8Array(12));
  const key = await deriveProfileKey(secret, salt, PROFILE_PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(stableProfileVault(vault));
  const ciphertextBuffer = await cryptoObject.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: utf8(PROFILE_AAD),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext),
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  return {
    version: PROFILE_VAULT_VERSION,
    kind: "formfill-profile-vault",
    cipher: "AES-GCM",
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PROFILE_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    checksum: await sha256Hex(ciphertext),
    createdAt: new Date(now).toISOString(),
  };
}

export async function decryptProfileVault(bundle: EncryptedProfileBundle, secret: string): Promise<ProfileVault> {
  if (
    bundle.version !== 1 ||
    bundle.kind !== "formfill-profile-vault" ||
    bundle.cipher !== "AES-GCM" ||
    bundle.kdf?.name !== "PBKDF2" ||
    bundle.kdf.hash !== "SHA-256"
  ) {
    throw new Error("Неподдерживаемый формат зашифрованного профиля.");
  }

  const salt = base64ToBytes(bundle.kdf.salt);
  const iv = base64ToBytes(bundle.iv);
  const ciphertext = base64ToBytes(bundle.ciphertext);
  if (salt.length < 16 || iv.length !== 12 || ciphertext.length < 16) {
    throw new Error("Повреждены криптографические параметры профиля.");
  }
  if ((await sha256Hex(ciphertext)) !== bundle.checksum.toLowerCase()) {
    throw new Error("Контрольная сумма профиля не совпадает.");
  }

  const key = await deriveProfileKey(secret, salt, bundle.kdf.iterations);
  try {
    const plaintext = await requireCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: utf8(PROFILE_AAD),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertext),
    );
    return validateProfileVault(JSON.parse(new TextDecoder().decode(plaintext)) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Расшифрованный профиль повреждён.");
    throw new Error("Не удалось открыть профиль: неверный код/пароль или данные повреждены.");
  }
}

export function serializeEncryptedProfileBundle(bundle: EncryptedProfileBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseEncryptedProfileBundle(text: string): EncryptedProfileBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл профиля не является корректным JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Файл профиля имеет неверный формат.");
  return parsed as EncryptedProfileBundle;
}
