import nodemailer from "nodemailer";
import { config } from "../config";

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransporter() {
  const { host, port, user, pass } = config.email;
  if (!host || !user || !pass) {
    throw new Error("Email is not configured on the server: set SMTP_HOST/SMTP_USER/SMTP_PASS");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const t = getTransporter();
  await t.sendMail({
    from: config.email.from ?? config.email.user,
    to,
    subject,
    text: body,
  });
}
