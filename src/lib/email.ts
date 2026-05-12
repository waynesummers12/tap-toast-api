import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

const INTERNAL_EMAILS = [
  "jen@coloradotapandtoast.com",
  "waynesummers12@gmail.com"
];

// 1. Customer confirmation
export async function sendCustomerConfirmationEmail({
  to,
  name,
  eventDate,
  amountPaid,
}: {
  to: string;
  name: string;
  eventDate: string;
  amountPaid: number;
}) {
  await resend.emails.send({
    from: "Colorado Tap & Toast <jen@coloradotapandtoast.com>",
    to,
    subject: "You're booked! 🎉 Colorado Tap & Toast",
    html: `
      <h2>You're officially booked 🎉</h2>
      <p>Hi ${name},</p>
      <p>We’re excited to be part of your event!</p>

      <h3>Event Details:</h3>
      <ul>
        <li><strong>Date:</strong> ${eventDate}</li>
        <li><strong>Deposit Paid:</strong> $${amountPaid}</li>
      </ul>

      <p>We’ll follow up closer to your event to finalize details.</p>

      <p>If you have any questions, just reply to this email.</p>

      <br />
      <p>— Colorado Tap & Toast 🍸</p>
    `,
  });
}

// 2. Internal notification
export async function sendInternalNotificationEmail({
  name,
  email,
  eventDate,
  amountPaid,
}: {
  name: string;
  email: string;
  eventDate: string;
  amountPaid: number;
}) {
  await resend.emails.send({
    from: "Tap & Toast Alerts <jen@coloradotapandtoast.com>",
    to: INTERNAL_EMAILS,
    subject: "🚨 New Booking Received",
    html: `
      <h2>New Booking 🚨</h2>

      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Event Date:</strong> ${eventDate}</p>
      <p><strong>Deposit:</strong> $${amountPaid}</p>
    `,
  });
}

// 3. Generic email sender (used by reminder system)
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  await resend.emails.send({
    from: "Colorado Tap & Toast <jen@coloradotapandtoast.com>",
    to,
    subject,
    html,
  });
}