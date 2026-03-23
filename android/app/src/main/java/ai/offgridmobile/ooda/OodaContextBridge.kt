package ai.offgridmobile.ooda

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

// ── Data classes ─────────────────────────────────────────────────────────────

/**
 * One action item or observation from the OODA cycle.
 */
data class OodaItem(
    val id: String,
    val phase: OodaPhase,
    val description: String,
    val priority: Int,         // 0 = normal, 1 = high, 2 = critical
    val timestamp: Long,
    val tags: List<String> = emptyList(),
)

enum class OodaPhase { OBSERVE, ORIENT, DECIDE, ACT }

/**
 * A full snapshot of the OODA Loop app's current state.
 */
data class OodaSnapshot(
    val observations: List<OodaItem>,
    val orientations: List<OodaItem>,
    val decisions: List<OodaItem>,
    val actions: List<OodaItem>,
    val activeCycle: String,       // e.g. "morning-review", "tactical-planning"
    val capturedAt: Instant,
) {
    val isEmpty: Boolean
        get() = observations.isEmpty() && orientations.isEmpty() &&
            decisions.isEmpty() && actions.isEmpty()
}

// ── Bridge ───────────────────────────────────────────────────────────────────

/**
 * IPC client for the OODA Loop app (package: com.necessitylabs.ooda).
 *
 * The OODA Loop app exposes its current cycle state via a ContentProvider
 * at authority "com.necessitylabs.ooda.provider". Expected URIs:
 *
 *   content://com.necessitylabs.ooda.provider/observations
 *     columns: id, description, priority, timestamp, tags
 *
 *   content://com.necessitylabs.ooda.provider/orientations
 *     columns: id, description, priority, timestamp, tags
 *
 *   content://com.necessitylabs.ooda.provider/decisions
 *     columns: id, description, priority, timestamp, tags
 *
 *   content://com.necessitylabs.ooda.provider/actions
 *     columns: id, description, priority, timestamp, tags
 *
 *   content://com.necessitylabs.ooda.provider/cycle
 *     columns: active_cycle (single row)
 *
 * If the OODA app is not installed, [getSnapshot] returns an empty snapshot
 * and [snapshotFlow] emits empty snapshots. The app never crashes.
 */
@Singleton
class OodaContextBridge @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    companion object {
        private const val AUTHORITY = "com.necessitylabs.ooda.provider"
        private const val POLL_INTERVAL_MS = 60_000L  // OODA state changes less frequently than RF

        private val OBSERVE_URI = Uri.parse("content://$AUTHORITY/observations")
        private val ORIENT_URI = Uri.parse("content://$AUTHORITY/orientations")
        private val DECIDE_URI = Uri.parse("content://$AUTHORITY/decisions")
        private val ACT_URI = Uri.parse("content://$AUTHORITY/actions")
        private val CYCLE_URI = Uri.parse("content://$AUTHORITY/cycle")
    }

    /** Single on-demand snapshot from the OODA Loop app. Empty if not installed. */
    suspend fun getSnapshot(): OodaSnapshot = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        OodaSnapshot(
            observations = queryPhase(resolver, OBSERVE_URI, OodaPhase.OBSERVE),
            orientations = queryPhase(resolver, ORIENT_URI, OodaPhase.ORIENT),
            decisions = queryPhase(resolver, DECIDE_URI, OodaPhase.DECIDE),
            actions = queryPhase(resolver, ACT_URI, OodaPhase.ACT),
            activeCycle = queryActiveCycle(resolver),
            capturedAt = Instant.now(),
        )
    }

    /**
     * Emits an [OodaSnapshot] immediately, then every [POLL_INTERVAL_MS] milliseconds.
     * Collecting on a background dispatcher is handled internally via [flowOn].
     */
    val snapshotFlow: Flow<OodaSnapshot> = flow {
        while (true) {
            emit(getSnapshot())
            delay(POLL_INTERVAL_MS)
        }
    }.flowOn(Dispatchers.IO)

    /** True when the OODA app is installed and its ContentProvider responds. */
    val isOodaAvailable: Boolean
        get() = try {
            val cursor = context.contentResolver.query(CYCLE_URI, null, null, null, null)
            cursor?.close()
            cursor != null
        } catch (_: Exception) {
            false
        }

    // ── Private query helpers ─────────────────────────────────────────────────

    private fun queryPhase(
        resolver: ContentResolver,
        uri: Uri,
        phase: OodaPhase,
    ): List<OodaItem> {
        return try {
            val cursor = resolver.query(uri, null, null, null, "priority DESC") ?: return emptyList()
            cursor.use { c ->
                val items = mutableListOf<OodaItem>()
                val idIdx = c.getColumnIndex("id")
                val descIdx = c.getColumnIndex("description")
                val prioIdx = c.getColumnIndex("priority")
                val tsIdx = c.getColumnIndex("timestamp")
                val tagsIdx = c.getColumnIndex("tags")
                while (c.moveToNext()) {
                    val rawTags = if (tagsIdx >= 0) c.getString(tagsIdx).orEmpty() else ""
                    val tags = if (rawTags.isNotEmpty()) rawTags.split(",").map { it.trim() } else emptyList()
                    items += OodaItem(
                        id = if (idIdx >= 0) c.getString(idIdx).orEmpty() else "",
                        phase = phase,
                        description = if (descIdx >= 0) c.getString(descIdx).orEmpty() else "",
                        priority = if (prioIdx >= 0) c.getInt(prioIdx) else 0,
                        timestamp = if (tsIdx >= 0) c.getLong(tsIdx) else 0L,
                        tags = tags,
                    )
                }
                items
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun queryActiveCycle(resolver: ContentResolver): String {
        return try {
            val cursor = resolver.query(CYCLE_URI, null, null, null, null) ?: return ""
            cursor.use { c ->
                if (!c.moveToFirst()) return ""
                val idx = c.getColumnIndex("active_cycle")
                if (idx >= 0) c.getString(idx).orEmpty() else ""
            }
        } catch (_: Exception) {
            ""
        }
    }
}
