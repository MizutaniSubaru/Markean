export type AppleAuthConfig = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  callbackUrl: string;
};

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_ISSUER = "https://appleid.apple.com";
const encoder = new TextEncoder();

export function buildAppleAuthorizationUrl(
  config: AppleAuthConfig,
  input: { state: string },
) {
  const url = new URL(APPLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", input.state);
  return url.toString();
}

type AppleTokenResponse = {
  id_token?: string;
};

type AppleIdentityClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
};

const toBase64Url = (value: Uint8Array) =>
  btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const encodeJsonSegment = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));

const pemToPkcs8Bytes = (pem: string) => {
  const normalized = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return fromBase64Url(normalized);
};

const derToJose = (der: Uint8Array) => {
  if (der[0] !== 0x30) {
    throw new Error("Invalid ECDSA signature");
  }

  let offset = 2;
  if (der[1] & 0x80) {
    const lengthBytes = der[1] & 0x7f;
    offset = 2 + lengthBytes;
  }

  const readInteger = () => {
    if (der[offset] !== 0x02) {
      throw new Error("Invalid ECDSA signature");
    }

    let length = der[offset + 1];
    let valueOffset = offset + 2;
    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      length = 0;
      for (let index = 0; index < lengthBytes; index += 1) {
        length = (length << 8) | der[valueOffset + index];
      }
      valueOffset += lengthBytes;
    }

    let value = der.slice(valueOffset, valueOffset + length);
    while (value.length > 0 && value[0] === 0x00) {
      value = value.slice(1);
    }

    offset = valueOffset + length;
    return value;
  };

  const r = readInteger();
  const s = readInteger();

  const paddedR = new Uint8Array(32);
  paddedR.set(r.slice(-32), 32 - Math.min(32, r.length));
  const paddedS = new Uint8Array(32);
  paddedS.set(s.slice(-32), 32 - Math.min(32, s.length));

  const jose = new Uint8Array(64);
  jose.set(paddedR, 0);
  jose.set(paddedS, 32);
  return jose;
};

async function importApplePrivateKey(privateKey: string) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Bytes(privateKey),
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );
}

async function createAppleClientSecret(config: AppleAuthConfig) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 60 * 24 * 180;
  const header = {
    alg: "ES256",
    kid: config.keyId,
    typ: "JWT",
  };
  const payload = {
    iss: config.teamId,
    iat: issuedAt,
    exp: expiresAt,
    aud: APPLE_ISSUER,
    sub: config.clientId,
  };
  const signingInput = `${encodeJsonSegment(header)}.${encodeJsonSegment(payload)}`;
  const key = await importApplePrivateKey(config.privateKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256",
      },
      key,
      encoder.encode(signingInput),
    ),
  );

  return `${signingInput}.${toBase64Url(signature.length === 64 ? signature : derToJose(signature))}`;
}

const parseJwtClaims = (idToken: string) => {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Apple identity token is invalid");
  }

  const payload = JSON.parse(
    new TextDecoder().decode(fromBase64Url(parts[1])),
  ) as AppleIdentityClaims;

  if (!payload.sub || !payload.email) {
    throw new Error("Apple identity token did not include the expected claims");
  }

  return {
    providerSubject: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
  };
};

export async function fetchAppleIdentity(config: AppleAuthConfig, code: string) {
  const clientSecret = await createAppleClientSecret(config);
  const tokenResponse = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Apple token exchange failed");
  }

  const tokenJson = (await tokenResponse.json()) as AppleTokenResponse;
  if (!tokenJson.id_token) {
    throw new Error("Apple token exchange did not return an identity token");
  }

  return parseJwtClaims(tokenJson.id_token);
}
