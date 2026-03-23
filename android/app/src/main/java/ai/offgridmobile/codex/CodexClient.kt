package ai.offgridmobile.codex

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * HTTP client for the CODEX Supabase knowledge-graph backend.
 *
 * CODEX can be reached in two ways (tried in order):
 *
 *   1. LAN endpoint — direct Supabase instance on local network
 *      (e.g. http://192.168.1.x:54321)
 *   2. Remote API endpoint — Supabase cloud project URL
 *      (e.g. https://xxxx.supabase.co)
 *
 * The base URL and anon-key are runtime-configurable from [CodexConfig].
 * If both fail, methods return empty results rather than throwing.
 *
 * Expected Supabase table schema (PostgREST REST API):
 *
 *   table: codex_entries
 *     id          uuid primary key
 *     title       text
 *     content     text
 *     tags        text[]
 *     source      text
 *     created_at  timestamptz
 *     updated_at  timestamptz
 *
 * PostgREST full-text search endpoint used:
 *   GET /rest/v1/codex_entries?content=fts.<query>&select=id,title,content,tags,source
 *
 * Conversation export endpoint:
 *   POST /rest/v1/codex_entries
 *     body: { title, content, tags, source }
 */
@Singleton
class CodexClient @Inject constructor(
    private val okHttpClient: OkHttpClient,
) {

    companion object {
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val CONNECT_TIMEOUT_MS = 5_000L
        private const val RESULT_LIMIT = 5
    }

    /**
     * Search CODEX for entries matching [query].
     *
     * Uses Supabase PostgREST full-text search (`fts`) on the `content` column,
     * falling back to a plain `ilike` wildcard if fts returns nothing.
     *
     * @param config Current CODEX connection settings.
     * @param query Natural-language search string from the LLM.
     * @return List of matching [CodexEntry] objects, empty on failure.
     */
    suspend fun search(config: CodexConfig, query: String): List<CodexEntry> =
        withContext(Dispatchers.IO) {
            if (!config.isConfigured) return@withContext emptyList()

            // Try FTS first, fall back to ilike
            val results = searchFts(config, query)
            if (results.isNotEmpty()) results
            else searchIlike(config, query)
        }

    /**
     * Export a conversation transcript to CODEX as a new entry.
     *
     * @param config Current CODEX connection settings.
     * @param title Entry title (e.g. conversation summary).
     * @param content Full transcript or summary text.
     * @param tags Metadata tags (e.g. ["conversation", "off-grid-ai"]).
     * @return true on success.
     */
    suspend fun exportEntry(
        config: CodexConfig,
        title: String,
        content: String,
        tags: List<String> = listOf("conversation", "off-grid-ai"),
    ): Boolean = withContext(Dispatchers.IO) {
        if (!config.isConfigured) return@withContext false
        try {
            val body = JSONObject().apply {
                put("title", title)
                put("content", content)
                put("tags", JSONArray(tags))
                put("source", "off-grid-ai")
            }.toString().toRequestBody(JSON_TYPE)

            val request = Request.Builder()
                .url("${config.baseUrl}/rest/v1/codex_entries")
                .post(body)
                .addHeader("apikey", config.anonKey)
                .addHeader("Authorization", "Bearer ${config.anonKey}")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .build()

            okHttpClient.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (_: Exception) {
            false
        }
    }

    // ── Private search helpers ────────────────────────────────────────────────

    private fun searchFts(config: CodexConfig, query: String): List<CodexEntry> {
        return try {
            val encoded = URLEncoder.encode(query, "UTF-8")
            val url = "${config.baseUrl}/rest/v1/codex_entries" +
                "?content=fts.${encoded}" +
                "&select=id,title,content,tags,source,created_at" +
                "&limit=$RESULT_LIMIT"

            executeSearch(config, url)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun searchIlike(config: CodexConfig, query: String): List<CodexEntry> {
        return try {
            val encoded = URLEncoder.encode("%${query.take(80)}%", "UTF-8")
            val url = "${config.baseUrl}/rest/v1/codex_entries" +
                "?content=ilike.${encoded}" +
                "&select=id,title,content,tags,source,created_at" +
                "&limit=$RESULT_LIMIT"

            executeSearch(config, url)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun executeSearch(config: CodexConfig, url: String): List<CodexEntry> {
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", config.anonKey)
            .addHeader("Authorization", "Bearer ${config.anonKey}")
            .addHeader("Accept", "application/json")
            .build()

        return okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return emptyList()
            val body = response.body?.string() ?: return emptyList()
            parseEntries(body)
        }
    }

    private fun parseEntries(json: String): List<CodexEntry> {
        return try {
            val arr = JSONArray(json)
            (0 until arr.length()).mapNotNull { i ->
                try {
                    val obj = arr.getJSONObject(i)
                    val tagsArr = obj.optJSONArray("tags")
                    val tags = if (tagsArr != null) {
                        (0 until tagsArr.length()).map { tagsArr.getString(it) }
                    } else emptyList()
                    CodexEntry(
                        id = obj.optString("id"),
                        title = obj.optString("title"),
                        content = obj.optString("content").take(500),
                        tags = tags,
                        source = obj.optString("source"),
                        createdAt = obj.optString("created_at"),
                    )
                } catch (_: Exception) {
                    null
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Verify connectivity to the CODEX backend.
     * Returns true if the /rest/v1/ endpoint responds within [CONNECT_TIMEOUT_MS].
     */
    suspend fun isReachable(config: CodexConfig): Boolean = withContext(Dispatchers.IO) {
        if (!config.isConfigured) return@withContext false
        try {
            val request = Request.Builder()
                .url("${config.baseUrl}/rest/v1/")
                .head()
                .addHeader("apikey", config.anonKey)
                .build()
            okHttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build()
                .newCall(request)
                .execute()
                .use { it.isSuccessful || it.code == 404 /* valid PostgREST response */ }
        } catch (_: Exception) {
            false
        }
    }
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Runtime configuration for the CODEX client.
 * Loaded from DataStore in [ai.offgridmobile.context.ContextSourceManager].
 */
data class CodexConfig(
    /** Supabase base URL — LAN (http://192.168.x.x:54321) or remote (https://xxx.supabase.co). */
    val baseUrl: String,
    /** Supabase anon/public key. */
    val anonKey: String,
) {
    val isConfigured: Boolean
        get() = baseUrl.isNotBlank() && anonKey.isNotBlank()
}

// ── Data model ────────────────────────────────────────────────────────────────

/**
 * A single CODEX knowledge-graph entry returned from the Supabase backend.
 */
data class CodexEntry(
    val id: String,
    val title: String,
    /** Content is truncated to 500 chars for context injection. */
    val content: String,
    val tags: List<String>,
    val source: String,
    val createdAt: String,
)
