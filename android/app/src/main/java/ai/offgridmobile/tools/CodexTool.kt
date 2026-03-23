package ai.offgridmobile.tools

import ai.offgridmobile.codex.CodexClient
import ai.offgridmobile.codex.CodexEntry
import ai.offgridmobile.context.ContextSourceManager
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM tool that queries the CODEX Supabase knowledge-graph backend.
 *
 * CODEX is Evan's personal knowledge base — notes, research, project data,
 * and anything else stored in the Supabase instance running on LAN or cloud.
 *
 * Tool description (injected into system prompt):
 *   "Searches your personal CODEX knowledge graph for entries matching a query.
 *    Returns relevant notes, research, or project data stored in your Supabase
 *    backend. Use this when asked about specific knowledge, past notes, or
 *    when deeper context from your knowledge base would help answer the question."
 *
 * Model invokes this tool by emitting:
 *   {"tool_use": {"name": "codex_search", "input": "search query here"}}
 *
 * Returns a JSON array of matching entries (title, content snippet, tags, source).
 * If CODEX is not configured or unreachable, returns a helpful error object.
 */
@Singleton
class CodexTool @Inject constructor(
    private val codexClient: CodexClient,
    private val contextSourceManager: ContextSourceManager,
) : Tool {

    override val name: String = "codex_search"

    override val description: String =
        "Searches your personal CODEX knowledge graph for entries matching a query. " +
            "Returns relevant notes, research, or project data stored in your Supabase backend. " +
            "Use this when asked about specific knowledge, past notes, or when deeper context " +
            "from your knowledge base would help answer the question. " +
            "Input: a natural-language search query string."

    override suspend fun execute(input: String): String {
        val config = contextSourceManager.codexConfig.value

        if (!config.isConfigured) {
            return JSONObject().apply {
                put("error", "CODEX is not configured. Set the Supabase URL and anon key in Settings → Context Sources.")
                put("configured", false)
            }.toString()
        }

        val query = input.trim().ifEmpty {
            return JSONObject().apply {
                put("error", "No search query provided")
            }.toString()
        }

        val entries = codexClient.search(config, query)

        if (entries.isEmpty()) {
            return JSONObject().apply {
                put("query", query)
                put("results", JSONArray())
                put("message", "No matching entries found in CODEX for: $query")
            }.toString()
        }

        return JSONObject().apply {
            put("query", query)
            put("result_count", entries.size)
            put("results", entries.toJson())
        }.toString(2)
    }

    private fun List<CodexEntry>.toJson(): JSONArray = JSONArray().also { arr ->
        forEach { entry ->
            arr.put(JSONObject().apply {
                put("id", entry.id)
                put("title", entry.title)
                put("content", entry.content)
                put("tags", JSONArray(entry.tags))
                put("source", entry.source)
                put("created_at", entry.createdAt)
            })
        }
    }
}
