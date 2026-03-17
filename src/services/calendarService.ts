

import { google } from "googleapis"

const auth = new google.auth.GoogleAuth({
  keyFile: "tap-toast-calendar.json", // service account key file placed in tap-toast-api root
  scopes: ["https://www.googleapis.com/auth/calendar"],
})

const calendar = google.calendar({ version: "v3", auth })

export async function createCalendarEvent(event: any) {
  try {
    const start = new Date(event.event_date)
    const end = new Date(start.getTime() + event.hours * 60 * 60 * 1000)

    await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: `Tap & Toast Event – ${event.name}`,
        description: `Client: ${event.name}\nEmail: ${event.email}\nLocation: ${event.location}\nGuests: ${event.guest_count}\nBartenders: ${event.bartenders}`,
        start: {
          dateTime: start.toISOString(),
        },
        end: {
          dateTime: end.toISOString(),
        },
      },
    })

    console.log("Calendar event created")
  } catch (error) {
    console.error("Calendar error:", error)
  }
}