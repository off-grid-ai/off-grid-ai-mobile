package ai.offgridmobile.ui.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ai.offgridmobile.codex.CodexClient
import ai.offgridmobile.context.ActiveSourcesState
import ai.offgridmobile.context.ContextSourceManager
import ai.offgridmobile.data.local.entities.Message
import ai.offgridmobile.data.repository.ConversationRepository
import ai.offgridmobile.data.repository.LlamaRepository
import ai.offgridmobile.spen.SpenInputModule
import ai.offgridmobile.spen.SpenInputState
import ai.offgridmobile.tools.ToolDispatcher
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val conversationRepository: ConversationRepository,
    private val llamaRepository: LlamaRepository,
    val spenInputModule: SpenInputModule,
    private val contextSourceManager: ContextSourceManager,
    private val codexClient: CodexClient,
    private val toolDispatcher: ToolDispatcher,
) : ViewModel() {

    sealed class ChatUiState {
        data object Loading : ChatUiState()
        data class Success(
            val messages: List<Message>,
            val isGenerating: Boolean,
            val streamingText: String,
            val modelName: String?,
        ) : ChatUiState()
        data class Error(val message: String) : ChatUiState()
    }

    sealed class ExportState {
        data object Idle : ExportState()
        data object InProgress : ExportState()
        data class Success(val message: String) : ExportState()
        data class Error(val message: String) : ExportState()
    }

    private val _uiState = MutableStateFlow<ChatUiState>(ChatUiState.Loading)
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val _exportState = MutableStateFlow<ExportState>(ExportState.Idle)
    val exportState: StateFlow<ExportState> = _exportState.asStateFlow()

    /** Combined live snapshot of all enabled context sources (AETHER, CODEX, OODA). */
    val activeSourcesState: StateFlow<ActiveSourcesState> =
        contextSourceManager.activeSourcesState

    /** S Pen connection state forwarded from [SpenInputModule]. */
    val isStylusConnected: StateFlow<Boolean> = spenInputModule.isStylusConnected

    /** Current S Pen input state — UI observes this to populate the TextField. */
    val spenInputState: StateFlow<SpenInputState> = spenInputModule.state

    private var conversationId: Long = -1L
    private var generationJob: Job? = null

    fun initialize(id: Long) {
        conversationId = id
        observeMessages()
    }

    private fun observeMessages() {
        viewModelScope.launch {
            conversationRepository.getMessages(conversationId).collect { result ->
                result.fold(
                    onSuccess = { messages ->
                        val current = _uiState.value
                        val isGenerating = (current as? ChatUiState.Success)?.isGenerating ?: false
                        val streaming = (current as? ChatUiState.Success)?.streamingText ?: ""
                        val modelName = (current as? ChatUiState.Success)?.modelName
                        _uiState.value = ChatUiState.Success(
                            messages = messages,
                            isGenerating = isGenerating,
                            streamingText = streaming,
                            modelName = modelName,
                        )
                    },
                    onFailure = {
                        _uiState.value = ChatUiState.Error(it.message ?: "Failed to load messages")
                    },
                )
            }
        }
    }

    fun sendMessage(content: String) {
        if (content.isBlank()) return
        viewModelScope.launch {
            conversationRepository.addMessage(conversationId, "user", content)

            val current = _uiState.value
            if (current is ChatUiState.Success) {
                _uiState.value = current.copy(isGenerating = true, streamingText = "")
            }

            generationJob = launch {
                var accumulated = ""
                llamaRepository.tokenStream(content).collect { result ->
                    result.fold(
                        onSuccess = { token ->
                            accumulated += token

                            // Check for tool_use block in accumulated response
                            val toolResult = toolDispatcher.maybeDispatch(accumulated)
                            if (toolResult != null) {
                                // Persist the model's tool call turn
                                conversationRepository.addMessage(
                                    conversationId,
                                    "assistant",
                                    accumulated,
                                )
                                // Inject tool result and continue generation
                                val toolContent = "[tool_result: ${toolResult.toolName}]\n${toolResult.result}"
                                conversationRepository.addMessage(conversationId, "tool", toolContent)
                                accumulated = ""
                                val s = _uiState.value
                                if (s is ChatUiState.Success) {
                                    _uiState.value = s.copy(streamingText = "")
                                }
                                return@collect
                            }

                            val s = _uiState.value
                            if (s is ChatUiState.Success) {
                                _uiState.value = s.copy(streamingText = accumulated)
                            }
                        },
                        onFailure = { err ->
                            _uiState.value = ChatUiState.Error(err.message ?: "Generation failed")
                            return@collect
                        },
                    )
                }

                if (accumulated.isNotEmpty()) {
                    conversationRepository.addMessage(conversationId, "assistant", accumulated)
                }

                val s = _uiState.value
                if (s is ChatUiState.Success) {
                    _uiState.value = s.copy(isGenerating = false, streamingText = "")
                }
            }
        }
    }

    fun stopGeneration() {
        llamaRepository.stopCompletion()
        generationJob?.cancel()
        generationJob = null
        val s = _uiState.value
        if (s is ChatUiState.Success) {
            _uiState.value = s.copy(isGenerating = false, streamingText = "")
        }
    }

    /**
     * Export the current conversation to CODEX as a knowledge-graph entry.
     *
     * Formats all user + assistant messages as a plain transcript and POSTs
     * to the configured CODEX Supabase backend.
     * Updates [exportState] with success/error for the snackbar.
     */
    fun exportToCodex() {
        val config = contextSourceManager.codexConfig.value
        if (!config.isConfigured) {
            _exportState.value = ExportState.Error(
                "CODEX is not configured. Set Supabase URL and key in Settings → Context Sources."
            )
            return
        }

        val messages = (_uiState.value as? ChatUiState.Success)?.messages
        if (messages.isNullOrEmpty()) {
            _exportState.value = ExportState.Error("No messages to export.")
            return
        }

        _exportState.value = ExportState.InProgress

        viewModelScope.launch {
            val transcript = buildTranscript(messages)
            val dateStr = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())
            val title = "Conversation export — $dateStr"

            val success = codexClient.exportEntry(
                config = config,
                title = title,
                content = transcript,
                tags = listOf("conversation", "off-grid-ai", "export"),
            )

            _exportState.value = if (success) {
                ExportState.Success("Conversation exported to CODEX.")
            } else {
                ExportState.Error("Export failed. Check CODEX connection in Settings.")
            }
        }
    }

    fun clearExportState() {
        _exportState.value = ExportState.Idle
    }

    /** Called by ChatScreen when S Pen handwriting commits text into the input field. */
    fun onSpenHandwritingCommitted(text: String) {
        spenInputModule.onHandwritingCommitted(text)
    }

    /** Called by ChatScreen after consuming the Committed state from [spenInputState]. */
    fun resetSpenState() {
        spenInputModule.reset()
    }

    fun dismissError() {
        val current = _uiState.value
        if (current is ChatUiState.Error) {
            _uiState.value = ChatUiState.Success(
                messages = emptyList(),
                isGenerating = false,
                streamingText = "",
                modelName = null,
            )
            observeMessages()
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun buildTranscript(messages: List<Message>): String {
        val sb = StringBuilder()
        messages
            .filter { it.role in listOf("user", "assistant") }
            .forEach { msg ->
                val roleLabel = when (msg.role) {
                    "user" -> "USER"
                    "assistant" -> "ASSISTANT"
                    else -> msg.role.uppercase()
                }
                sb.appendLine("[$roleLabel]")
                sb.appendLine(msg.content)
                sb.appendLine()
            }
        return sb.toString().trim()
    }
}
