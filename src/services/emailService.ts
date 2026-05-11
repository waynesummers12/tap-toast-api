import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY as string)
const INTERNAL_EMAILS = [
  "jen@coloradotapandtoast.com",
  "waynesummers12@gmail.com"
]

export async function sendBookingConfirmation(event: any) {
  try {
    await resend.emails.send({
      from: "Tap & Toast <jen@coloradotapandtoast.com>",
      to: event.customer_email || event.email,
      bcc: INTERNAL_EMAILS,
      subject: "🎉 Your Tap & Toast Event is Confirmed",
      html: `
      <div style="font-family: Arial, sans-serif; background-color: #000000; padding: 30px; color: #ffffff;">

        <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 10px; overflow: hidden; border: 1px solid #222;">

          <div style="background: linear-gradient(to right, #facc15, #eab308); padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #000;">Tap & Toast</h1>
            <p style="margin: 0; font-size: 14px; color: #000;">Mobile Bar Experience</p>
          </div>

          <div style="padding: 25px;">

            <h2 style="margin-top: 0;">🎉 Your Event is Confirmed</h2>

            <p>Hi <strong>${event.customer_name || event.name}</strong>,</p>

            <p>
              Your deposit has been successfully received and your event is officially booked.
              We’re excited to be part of your special day.
            </p>

            <div style="margin: 20px 0; padding: 15px; background: #1a1a1a; border-radius: 8px;">
              <h3 style="margin-top: 0; color: #facc15;">Event Details</h3>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${event.event_date}</p>
              <p style="margin: 5px 0;"><strong>Location:</strong> ${event.location}</p>
              <p style="margin: 5px 0;"><strong>Duration:</strong> ${event.hours} hours</p>
              <p style="margin: 5px 0;"><strong>Bartenders:</strong> ${event.bartenders}</p>
            </div>

            <p>
              Your remaining balance will be due <strong>10 days prior</strong> to your event.
            </p>

            <div style="margin: 25px 0; padding: 15px; background: #111; border: 1px solid #333; border-radius: 8px;">
              <p style="margin: 0; font-size: 14px; color: #facc15;">
                Want to elevate your experience?
              </p>
              <p style="margin: 5px 0 0 0; font-size: 13px;">
                You can upgrade your package anytime — add bartenders, extend hours, or customize your bar.
              </p>
            </div>

            <p style="margin-top: 30px;">Cheers,</p>
            <p style="margin: 0;">Tap & Toast 🍸</p>

          </div>

        </div>

      </div>
      `
    })

    console.log("Confirmation email sent")
  } catch (error) {
    console.error("Email error:", error)
  }
}

export async function sendInternalNotification(event: any) {
  try {
    await resend.emails.send({
      from: "Tap & Toast Alerts <jen@coloradotapandtoast.com>",
      to: ["jen@coloradotapandtoast.com", "waynesummers12@gmail.com"],
      subject: `🚨 New Booking - ${event.event_date}`,
      html: `
        <h2>New Booking 🚨</h2>
        <p><strong>Name:</strong> ${event.customer_name || event.name}</p>
        <p><strong>Email:</strong> ${event.customer_email || event.email}</p>
        <p><strong>Event Date:</strong> ${event.event_date}</p>
        <p><strong>Event Type:</strong> ${event.event_type || "N/A"}</p>
        <p><strong>Location:</strong> ${event.location || "N/A"}</p>
      `,
    })

    console.log("Internal notification email sent")
  } catch (error) {
    console.error("Internal email error:", error)
  }
}