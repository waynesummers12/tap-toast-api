import { Router } from "express"
import { createClient } from "@supabase/supabase-js"

const router = Router()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type BartenderInput = {
  name: string
  hours?: number
  pay?: number
}

type BartenderRoster = {
  id?: string
  name: string
  phone?: string
  pay_rate?: number
}

// Get bartender roster
router.get("/bartenders", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bartenders")
      .select("*")
      .order("name", { ascending: true })

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Failed to fetch bartenders" })
    }

    res.json(data || [])
  } catch (err) {
    console.error("fetch bartenders error", err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Add bartender to roster
router.post("/bartenders", async (req, res) => {
  try {
    const { name, phone, pay_rate } = req.body as BartenderRoster

    if (!name) {
      return res.status(400).json({ error: "name is required" })
    }

    const { data, error } = await supabase
      .from("bartenders")
      .insert({ name, phone: phone ?? null, pay_rate: pay_rate ?? null })
      .select()
      .single()

    if (error) {
      console.error(error)
      return res.status(500).json({ error: "Failed to create bartender" })
    }

    res.json({ success: true, bartender: data })
  } catch (err) {
    console.error("create bartender error", err)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Assign bartenders to an event
router.post("/events/assign-bartenders", async (req, res) => {
  try {
    const { event_id, bartenders } = req.body as { event_id: string; bartenders: BartenderInput[] }

    if (!event_id || !Array.isArray(bartenders) || bartenders.length === 0) {
      return res.status(400).json({
        error: "event_id and bartenders[] are required"
      })
    }

    // Remove existing bartender assignments
    const { error: deleteError } = await supabase
      .from("event_bartenders")
      .delete()
      .eq("event_id", event_id)

    if (deleteError) {
      console.error(deleteError)
      return res.status(500).json({ error: "Failed to clear existing assignments" })
    }

    // Create rows for new assignments
    const rows = bartenders.map((b) => ({
      event_id,
      bartender_name: b.name,
      hours: b.hours ?? null,
      pay: b.pay ?? null
    }))

    const { error: insertError } = await supabase
      .from("event_bartenders")
      .insert(rows)

    if (insertError) {
      console.error(insertError)
      return res.status(500).json({ error: "Failed to assign bartenders" })
    }

    const { count } = await supabase
      .from("event_bartenders")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event_id)

    res.json({
      success: true,
      event_id,
      assigned_count: count || 0
    })

  } catch (error) {
    console.error("assign-bartenders error", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

export default router