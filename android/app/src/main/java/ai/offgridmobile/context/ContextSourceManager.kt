package ai.offgridmobile.context

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ai.offgridmobile.aether.AetherContextBridge
import ai.offgridmobile.aether.AetherSnapshot
import ai.offgridmobile.codex.CodexClient
import ai.offgridmobile.codex.CodexConfig
import ai.offgridmobile.ooda.OodaContextBridge
import ai.offgridmobile.ooda.OodaSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Central manager for all context sources: AETHER, CODEX, and OODA.
 *
 * Responsibilities:
 *  - Persists enable/disable toggles and CODEX connection settings to DataStore.
 *  - Exposes [activeSourcesState] — a combined live snapshot of all enabled sources.
 *  - Provides per-source enable flags and CODEX config to [ToolDispatcher] tools.
 *
 * DataStore keys:
 *   context_aether_enabled   (Boolean, default true)
 *   context_codex_enabled    (Boolean, default false — requires configuration)
 *   context_ooda_enabled     (Boolean, default true)
 *   context_codex_url        (String)
 *   context_codex_anon_key   (String)
 */
@Singleton
class ContextSourceManager @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val aetherContextBridge: AetherContextBridge,
    private val oodaContextBridge: OodaContextBridge,
    private val codexClient: CodexClient,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // ── DataStore keys ────────────────────────────────────────────────────────

    companion object {
        val KEY_AETHER_ENABLED = booleanPreferencesKey("context_aether_enabled")
        val KEY_CODEX_ENABLED = booleanPreferencesKey("context_codex_enabled")
        val KEY_OODA_ENABLED = booleanPreferencesKey("context_ooda_enabled")
        val KEY_CODEX_URL = stringPreferencesKey("context_codex_url")
        val KEY_CODEX_ANON_KEY = stringPreferencesKey("context_codex_anon_key")
    }

    // ── Persisted enable flags ────────────────────────────────────────────────

    val isAetherEnabled: StateFlow<Boolean> = dataStore.data
        .map { prefs -> prefs[KEY_AETHER_ENABLED] ?: true }
        .catch { emit(true) }
        .stateIn(scope, SharingStarted.Eagerly, true)

    val isCodexEnabled: StateFlow<Boolean> = dataStore.data
        .map { prefs -> prefs[KEY_CODEX_ENABLED] ?: false }
        .catch { emit(false) }
        .stateIn(scope, SharingStarted.Eagerly, false)

    val isOodaEnabled: StateFlow<Boolean> = dataStore.data
        .map { prefs -> prefs[KEY_OODA_ENABLED] ?: true }
        .catch { emit(true) }
        .stateIn(scope, SharingStarted.Eagerly, true)

    // ── CODEX config ──────────────────────────────────────────────────────────

    val codexConfig: StateFlow<CodexConfig> = dataStore.data
        .map { prefs ->
            CodexConfig(
                baseUrl = prefs[KEY_CODEX_URL] ?: "",
                anonKey = prefs[KEY_CODEX_ANON_KEY] ?: "",
            )
        }
        .catch { emit(CodexConfig("", "")) }
        .stateIn(scope, SharingStarted.Eagerly, CodexConfig("", ""))

    // ── Live snapshots ────────────────────────────────────────────────────────

    private val _aetherSnapshot = MutableStateFlow<AetherSnapshot?>(null)
    val aetherSnapshot: StateFlow<AetherSnapshot?> = _aetherSnapshot

    private val _oodaSnapshot = MutableStateFlow<OodaSnapshot?>(null)
    val oodaSnapshot: StateFlow<OodaSnapshot?> = _oodaSnapshot

    /** CODEX reachability status — updated whenever the config changes. */
    private val _codexReachable = MutableStateFlow(false)
    val codexReachable: StateFlow<Boolean> = _codexReachable

    // ── Combined active-sources state ─────────────────────────────────────────

    /**
     * Combined snapshot of all enabled context sources.
     * Updated whenever any source's data or enable state changes.
     */
    val activeSourcesState: StateFlow<ActiveSourcesState> = combine(
        isAetherEnabled,
        isCodexEnabled,
        isOodaEnabled,
        _aetherSnapshot,
        _oodaSnapshot,
        _codexReachable,
    ) { values ->
        val aetherEnabled = values[0] as Boolean
        val codexEnabled = values[1] as Boolean
        val oodaEnabled = values[2] as Boolean
        val aetherSnap = values[3] as AetherSnapshot?
        val oodaSnap = values[4] as OodaSnapshot?
        val codexReachable = values[5] as Boolean

        ActiveSourcesState(
            aetherEnabled = aetherEnabled,
            codexEnabled = codexEnabled,
            oodaEnabled = oodaEnabled,
            aetherSnapshot = if (aetherEnabled) aetherSnap else null,
            oodaSnapshot = if (oodaEnabled) oodaSnap else null,
            codexReachable = codexEnabled && codexReachable,
        )
    }.stateIn(scope, SharingStarted.Eagerly, ActiveSourcesState())

    init {
        startAetherPolling()
        startOodaPolling()
        startCodexReachabilityCheck()
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    private fun startAetherPolling() {
        scope.launch {
            aetherContextBridge.snapshotFlow
                .catch { /* graceful — AETHER not installed */ }
                .collect { snapshot ->
                    if (isAetherEnabled.value) _aetherSnapshot.value = snapshot
                }
        }
    }

    private fun startOodaPolling() {
        scope.launch {
            oodaContextBridge.snapshotFlow
                .catch { /* graceful — OODA not installed */ }
                .collect { snapshot ->
                    if (isOodaEnabled.value) _oodaSnapshot.value = snapshot
                }
        }
    }

    private fun startCodexReachabilityCheck() {
        scope.launch {
            codexConfig.collect { config ->
                _codexReachable.value = if (config.isConfigured && isCodexEnabled.value) {
                    codexClient.isReachable(config)
                } else {
                    false
                }
            }
        }
    }

    // ── Mutators ──────────────────────────────────────────────────────────────

    fun setAetherEnabled(enabled: Boolean) {
        scope.launch { dataStore.edit { prefs -> prefs[KEY_AETHER_ENABLED] = enabled } }
    }

    fun setCodexEnabled(enabled: Boolean) {
        scope.launch { dataStore.edit { prefs -> prefs[KEY_CODEX_ENABLED] = enabled } }
    }

    fun setOodaEnabled(enabled: Boolean) {
        scope.launch { dataStore.edit { prefs -> prefs[KEY_OODA_ENABLED] = enabled } }
    }

    fun updateCodexConfig(baseUrl: String, anonKey: String) {
        scope.launch {
            dataStore.edit { prefs ->
                prefs[KEY_CODEX_URL] = baseUrl.trim()
                prefs[KEY_CODEX_ANON_KEY] = anonKey.trim()
            }
        }
    }
}

// ── State model ───────────────────────────────────────────────────────────────

/**
 * Snapshot of all active context source states, consumed by the UI and
 * available for inclusion in the LLM system prompt via [ToolDispatcher].
 */
data class ActiveSourcesState(
    val aetherEnabled: Boolean = false,
    val codexEnabled: Boolean = false,
    val oodaEnabled: Boolean = false,
    val aetherSnapshot: AetherSnapshot? = null,
    val oodaSnapshot: OodaSnapshot? = null,
    val codexReachable: Boolean = false,
) {
    /** True if any source has live data to show. */
    val hasActiveSources: Boolean
        get() = (aetherEnabled && aetherSnapshot != null &&
            (aetherSnapshot.wifiNetworks.isNotEmpty() ||
                aetherSnapshot.bluetoothDevices.isNotEmpty() ||
                aetherSnapshot.cellularInfo != null)) ||
            (oodaEnabled && oodaSnapshot != null && !oodaSnapshot.isEmpty) ||
            (codexEnabled && codexReachable)

    /** Count of enabled + connected sources for the indicator badge. */
    val activeSourceCount: Int
        get() {
            var count = 0
            if (aetherEnabled && aetherSnapshot != null) count++
            if (oodaEnabled && oodaSnapshot != null && !oodaSnapshot.isEmpty) count++
            if (codexEnabled && codexReachable) count++
            return count
        }
}
