export const sendLoginCode = async (env: Env, email: string, otp: string) => {
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      subject: "Your Minisphere login code",
      text: `Your Minisphere login code is ${otp}.\n\nIt expires in 10 minutes. Only the latest code works. Do not share this code.\n\nIf you did not request this code, you can ignore this email.`,
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    // Do not include the provider response: it may contain private email data.
    throw new Error("Could not send the login code. Try again later.");
  }
};
