export type GoogleAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function buildGoogleAuthorizationUrl(
  config: GoogleAuthConfig,
  input: { state: string },
) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

type GoogleTokenResponse = {
  access_token?: string;
};

type GoogleUserInfoResponse = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
};

export async function fetchGoogleIdentity(config: GoogleAuthConfig, code: string) {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Google token exchange failed");
  }

  const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!tokenJson.access_token) {
    throw new Error("Google token exchange did not return an access token");
  }

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
    },
  });

  if (!profileResponse.ok) {
    throw new Error("Google profile lookup failed");
  }

  const profile = (await profileResponse.json()) as GoogleUserInfoResponse;
  if (!profile.sub || !profile.email) {
    throw new Error("Google profile lookup did not return the expected identity");
  }

  return {
    providerSubject: profile.sub,
    email: profile.email.trim().toLowerCase(),
    emailVerified: profile.email_verified === true || profile.email_verified === "true",
  };
}
