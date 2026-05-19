const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SECRET_KEY = "CamOllin-clave-secreta-2026";

async function getKey() {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET_KEY),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("CamOllin-salt"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function encryptText(text) {
  if (!text) return "";

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    encoder.encode(text)
  );

  return JSON.stringify({
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encrypted)
  });
}

export async function decryptText(encryptedText) {
  if (!encryptedText) return "";

  try {
    const payload = JSON.parse(encryptedText);
    const key = await getKey();

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(base64ToArrayBuffer(payload.iv))
      },
      key,
      base64ToArrayBuffer(payload.data)
    );

    return decoder.decode(decrypted);
  } catch (error) {
    console.error("No se pudo desencriptar:", error);

    // Esto permite seguir mostrando mensajes viejos sin cifrar
    return encryptedText;
  }
}