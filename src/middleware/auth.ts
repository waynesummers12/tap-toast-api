import { RequestHandler } from "express"
import { supabase } from "../lib/supabase"

export const requireAdmin: RequestHandler = async (req, res, next) => {
	const authorization = req.get("authorization")
	const match = authorization?.match(/^Bearer ([^\s]+)$/i)

	if (!match) {
		return res.status(401).json({ error: "Unauthorized" })
	}

	try {
		const { data: { user }, error } = await supabase.auth.getUser(match[1])

		if (error || !user) {
			return res.status(401).json({ error: "Unauthorized" })
		}

		const email = user.email?.trim().toLowerCase()
		const adminEmails = new Set(
			(process.env.TAP_TOAST_ADMIN_EMAILS || "")
				.split(",")
				.map((value) => value.trim().toLowerCase())
				.filter(Boolean)
		)

		if (!email || !adminEmails.has(email)) {
			return res.status(403).json({ error: "Forbidden" })
		}

		next()
	} catch {
		return res.status(401).json({ error: "Unauthorized" })
	}
}

export const requireAdminForNonDeposit: RequestHandler = (req, res, next) => {
	if (req.body?.type === "deposit") {
		return next()
	}

	return requireAdmin(req, res, next)
}
