const encoder = new TextEncoder();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createOpaqueToken(prefix: "ms" | "ml" | "ac") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function hashOpaqueToken(value: string) {
  return sha256(value);
}
