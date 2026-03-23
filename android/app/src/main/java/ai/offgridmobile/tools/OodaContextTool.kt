package ai.offgridmobile.tools

import ai.offgridmobile.ooda.OodaContextBridge
import ai.offgridmobile.ooda.OodaItem
import ai.offgridmobile.ooda.OodaPhase
import ai.offgridmobile.ooda.OodaSnapshot
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM tool that provides a structured snapshot of the current OODA Loop context.
 *
 * OODA (Observe, Orient, Decide, Act) is Evan's personal decision-making and
 * situational awareness app. This tool surfaces the current cycle state so the
 * LLM can reason about ongoing priorities, decisions, and actions.
 *
 * Tool description (injected into system prompt):
 *   "Returns the current state of your OODA Loop decision cycle — active
 *    observations, orientations, pending decisions, and queued actions. Use
 *    this when asked about current priorities, what you're working on, or
 *    when situational-awareness context would improve the response."
 *
 * Model invokes this tool by emitting:
 *   {"tool_use": {"name": "ooda_snapshot", "input": ""}}
 *
 * Returns a structured JSON object with all four OODA phases.
 * If the OODA app is not installed, returns a graceful error object.
 */
@Singleton
class OodaContextTool @Inject constructor(
    private val oodaContextBridge: OodaContextBridge,
) : Tool {

    override val name: String = "ooda_snapshot"

    override val description: String =
        "Returns the current state of your OODA Loop decision cycle — active observations, " +
            "orientations, pending decisions, and queued actions. Use this when asked about " +
            "current priorities, what you're working on, ongoing projects, or when " +
            "situational-awareness context would improve the response."

    override suspend fun execute(input: String): String {
        if (!oodaContextBridge.isOodaAvailable) {
            return JSONObject().apply {
                put("error", "OODA Loop app is not installed on this device")
                put("available", false)
            }.toString()
        }

        val snapshot = oodaContextBridge.getSnapshot()

        if (snapshot.isEmpty) {
            return JSONObject().apply {
                put("available", true)
                put("message", "OODA Loop is installed but has no active items in the current cycle")
                put("active_cycle", snapshot.activeCycle.ifEmpty { "none" })
                put("capturedAt", snapshot.capturedAt.toString())
            }.toString()
        }

        return snapshotToJson(snapshot)
    }

    private fun snapshotToJson(snapshot: OodaSnapshot): String {
        return JSONObject().apply {
            put("capturedAt", snapshot.capturedAt.toString())
            put("active_cycle", snapshot.activeCycle.ifEmpty { "unnamed" })
            put("observe", snapshot.observations.toJson())
            put("orient", snapshot.orientations.toJson())
            put("decide", snapshot.decisions.toJson())
            put("act", snapshot.actions.toJson())
            put("summary", buildSummary(snapshot))
        }.toString(2)
    }

    private fun List<OodaItem>.toJson(): JSONArray = JSONArray().also { arr ->
        forEach { item ->
            arr.put(JSONObject().apply {
                put("id", item.id)
                put("description", item.description)
                put("priority", priorityLabel(item.priority))
                put("timestamp", item.timestamp)
                if (item.tags.isNotEmpty()) put("tags", JSONArray(item.tags))
            })
        }
    }

    private fun priorityLabel(priority: Int): String = when (priority) {
        2 -> "critical"
        1 -> "high"
        else -> "normal"
    }

    private fun buildSummary(snapshot: OodaSnapshot): String {
        val parts = mutableListOf<String>()
        if (snapshot.observations.isNotEmpty())
            parts += "${snapshot.observations.size} observation(s)"
        if (snapshot.orientations.isNotEmpty())
            parts += "${snapshot.orientations.size} orientation(s)"
        if (snapshot.decisions.isNotEmpty())
            parts += "${snapshot.decisions.size} pending decision(s)"
        if (snapshot.actions.isNotEmpty())
            parts += "${snapshot.actions.size} queued action(s)"
        val cycle = if (snapshot.activeCycle.isNotEmpty()) " in cycle '${snapshot.activeCycle}'" else ""
        return parts.joinToString(", ") + cycle
    }
}
