package ai.offgridmobile.tools

import org.json.JSONException
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Routes tool_use blocks in LLM responses to the appropriate [Tool] implementation.
 *
 * The LLM should emit tool calls in one of these formats (both supported):
 *
 *   Format A — JSON object in the streamed text:
 *     {"tool_use": {"name": "aether_rf_snapshot", "input": ""}}
 *
 *   Format B — Markdown code fence wrapping the same JSON:
 *     ```json
 *     {"tool_use": {"name": "aether_rf_snapshot", "input": "query"}}
 *     ```
 *
 * To add a new tool: inject it here and add it to the [tools] map in [init].
 */
@Singleton
class ToolDispatcher @Inject constructor(
    private val aetherTool: AetherTool,
    private val codexTool: CodexTool,
    private val oodaContextTool: OodaContextTool,
) {

    private val tools: Map<String, Tool> by lazy {
        listOf(aetherTool, codexTool, oodaContextTool).associateBy { it.name }
    }

    /** All registered tools — used to build the system prompt tool manifest. */
    fun availableTools(): List<Tool> = tools.values.toList()

    /**
     * Parse and execute a tool_use block from the LLM's raw response text.
     *
     * @param responseText The full (or partial) text emitted by the model.
     * @return [ToolResult] with the tool name and JSON result, or null if no
     *         tool_use block was detected in [responseText].
     */
    suspend fun maybeDispatch(responseText: String): ToolResult? {
        val (name, input) = extractToolCall(responseText) ?: return null
        val tool = tools[name] ?: return ToolResult(
            toolName = name,
            result = """{"error": "Unknown tool: $name"}""",
            isError = true,
        )
        return try {
            val result = tool.execute(input)
            ToolResult(toolName = name, result = result, isError = false)
        } catch (e: Exception) {
            ToolResult(
                toolName = name,
                result = """{"error": "${e.message?.replace("\"", "'")}"}""",
                isError = true,
            )
        }
    }

    /**
     * Produce a tool manifest snippet suitable for inclusion in the system prompt.
     * Each tool is listed with its name and description.
     */
    fun buildSystemPromptToolSection(): String {
        if (tools.isEmpty()) return ""
        val sb = StringBuilder()
        sb.appendLine("\n## Available Tools")
        sb.appendLine("You have access to the following tools. To call a tool, emit exactly:")
        sb.appendLine('`' + """{"tool_use": {"name": "<tool_name>", "input": "<optional_input>"}}""" + '`')
        sb.appendLine()
        tools.values.forEach { tool ->
            sb.appendLine("- **${tool.name}**: ${tool.description}")
        }
        return sb.toString()
    }

    // ── Parsing ───────────────────────────────────────────────────────────────

    private fun extractToolCall(text: String): Pair<String, String>? {
        val cleaned = text
            .replace(Regex("```json\\s*"), "")
            .replace(Regex("```\\s*"), "")
            .trim()

        // Find all JSON-object-like substrings and try to parse them
        val startIndex = cleaned.indexOf("{")
        if (startIndex < 0) return null

        var depth = 0
        var end = -1
        for (i in startIndex until cleaned.length) {
            when (cleaned[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) {
                        end = i + 1
                        break
                    }
                }
            }
        }
        if (end < 0) return null

        return try {
            val obj = JSONObject(cleaned.substring(startIndex, end))
            val toolUse = obj.optJSONObject("tool_use") ?: return null
            val name = toolUse.optString("name").takeIf { it.isNotEmpty() } ?: return null
            val input = toolUse.optString("input", "")
            Pair(name, input)
        } catch (_: JSONException) {
            null
        }
    }
}

data class ToolResult(
    val toolName: String,
    val result: String,
    val isError: Boolean,
)
