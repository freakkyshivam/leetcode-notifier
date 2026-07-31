import nodemailer from "nodemailer";
import { config } from "../config";

function createSmtpTransporter(port: number, secure: boolean) {
  const { host, user, pass } = config.email;
  if (!host || !user || !pass) return undefined;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 5000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const fromEmail = config.email.from ?? config.email.user ?? "no-reply@leetcode-notifier.com";

  // 1. Try Brevo HTTP API if BREVO_API_KEY is configured
  if (config.email.brevoApiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "api-key": config.email.brevoApiKey,
        },
        body: JSON.stringify({
          sender: { email: fromEmail },
          to: [{ email: to }],
          subject,
          textContent: body,
        }),
      });

      if (res.ok) {
        console.log(`[email] Successfully sent email to ${to} via Brevo API`);
        return;
      }

      const errText = await res.text();
      console.warn(`[email] Brevo API send returned status ${res.status}: ${errText}`);
    } catch (err) {
      console.error("[email] Error sending email via Brevo API:", err);
    }
  }

  // 2. Try configured SMTP settings (e.g. Port 587 or Port 465)
  const configuredPort = config.email.port || 587;
  const isSecure = configuredPort === 465;
  const primaryTransporter = createSmtpTransporter(configuredPort, isSecure);

  if (primaryTransporter) {
    try {
      await primaryTransporter.sendMail({
        from: fromEmail,
        to,
        subject,
        text: body,
      });
      console.log(`[email] Successfully sent email to ${to} via SMTP (port ${configuredPort})`);
      return;
    } catch (err: any) {
      console.warn(`[email] Primary SMTP port ${configuredPort} failed (${err.code || err.message}). Retrying fallback SMTP ports...`);
    }
  }

  // 3. Fallback: Try alternative Brevo SMTP ports (Port 465 SSL or Port 2525) if primary timed out on cloud host
  const fallbackPorts = [
    { port: 465, secure: true },
    { port: 2525, secure: false },
  ].filter((p) => p.port !== configuredPort);

  for (const fallback of fallbackPorts) {
    const fallbackTransporter = createSmtpTransporter(fallback.port, fallback.secure);
    if (!fallbackTransporter) break;

    try {
      await fallbackTransporter.sendMail({
        from: fromEmail,
        to,
        subject,
        text: body,
      });
      console.log(`[email] Successfully sent email to ${to} via fallback SMTP port ${fallback.port}`);
      return;
    } catch (err: any) {
      console.warn(`[email] Fallback SMTP port ${fallback.port} failed: ${err.message || String(err)}`);
    }
  }

  // 4. Ultimate Fallback: Print OTP to server logs so verification is never blocked
  console.log(`====================================================`);
  console.log(`[email] ⚠️ EMAIL NOT SENT TO ${to} (All SMTP ports timed out on cloud host)`);
  console.log(`[email] SUBJECT: ${subject}`);
  console.log(`[email] BODY:\n${body}`);
  console.log(`====================================================`);

  const otpMatch = body.match(/\b\d{6}\b/);
  if (otpMatch) {
    console.log(`🔑 [AUTH FALLBACK] OTP Code for ${to}: >>> ${otpMatch[0]} <<<`);
  }
}
