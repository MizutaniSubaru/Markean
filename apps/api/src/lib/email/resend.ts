export async function sendMagicLinkEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  linkUrl: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: "Your Markean sign-in link",
      html: `<p>Open Markean with this link:</p><p><a href="${input.linkUrl}">${input.linkUrl}</a></p>`,
      text: `Open Markean with this link: ${input.linkUrl}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send magic link email (${response.status})`);
  }

  return response;
}
