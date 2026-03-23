package ai.offgridmobile.ui.screens

import android.view.inputmethod.InputMethodManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.offgridmobile.R
import ai.offgridmobile.data.local.entities.Message
import ai.offgridmobile.spen.SpenInputState
import ai.offgridmobile.ui.components.ContextDashboardSheet
import ai.offgridmobile.ui.components.ContextSourcesIndicator
import ai.offgridmobile.ui.theme.OledBlack
import ai.offgridmobile.ui.theme.OledSurface
import ai.offgridmobile.ui.theme.OledSurfaceVariant
import ai.offgridmobile.ui.theme.TealDark
import ai.offgridmobile.ui.theme.TealPrimary
import ai.offgridmobile.ui.viewmodels.ChatViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    conversationId: Long,
    onNavigateBack: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    LaunchedEffect(conversationId) {
        viewModel.initialize(conversationId)
    }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val spenState by viewModel.spenInputState.collectAsStateWithLifecycle()
    val isStylusConnected by viewModel.isStylusConnected.collectAsStateWithLifecycle()
    val activeSourcesState by viewModel.activeSourcesState.collectAsStateWithLifecycle()
    val exportState by viewModel.exportState.collectAsStateWithLifecycle()

    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var showContextDashboard by remember { mutableStateOf(false) }
    var showOverflowMenu by remember { mutableStateOf(false) }

    LaunchedEffect(uiState) {
        val state = uiState
        if (state is ChatViewModel.ChatUiState.Success) {
            val itemCount = state.messages.size + if (state.streamingText.isNotEmpty()) 1 else 0
            if (itemCount > 0) {
                scope.launch { listState.animateScrollToItem(itemCount - 1) }
            }
        }
    }

    LaunchedEffect(uiState) {
        if (uiState is ChatViewModel.ChatUiState.Error) {
            val msg = (uiState as ChatViewModel.ChatUiState.Error).message
            snackbarHostState.showSnackbar(msg)
            viewModel.dismissError()
        }
    }

    LaunchedEffect(exportState) {
        when (val s = exportState) {
            is ChatViewModel.ExportState.Success ->
                snackbarHostState.showSnackbar(s.message)
            is ChatViewModel.ExportState.Error ->
                snackbarHostState.showSnackbar(s.message)
            else -> Unit
        }
        if (exportState !is ChatViewModel.ExportState.Idle) viewModel.clearExportState()
    }

    Scaffold(
        containerColor = OledBlack,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        val modelName = (uiState as? ChatViewModel.ChatUiState.Success)?.modelName
                        Text(
                            text = modelName ?: stringResource(R.string.chat_no_model),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.chat_navigate_back),
                            )
                        }
                    },
                    actions = {
                        // Overflow menu: Export to CODEX
                        Box {
                            IconButton(onClick = { showOverflowMenu = true }) {
                                Icon(
                                    Icons.Filled.MoreVert,
                                    contentDescription = stringResource(R.string.chat_menu),
                                    tint = MaterialTheme.colorScheme.onBackground,
                                )
                            }
                            DropdownMenu(
                                expanded = showOverflowMenu,
                                onDismissRequest = { showOverflowMenu = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.chat_export_to_codex)) },
                                    leadingIcon = {
                                        Icon(Icons.Filled.Upload, null, tint = TealPrimary)
                                    },
                                    onClick = {
                                        showOverflowMenu = false
                                        viewModel.exportToCodex()
                                    },
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = OledBlack,
                        titleContentColor = MaterialTheme.colorScheme.onBackground,
                        navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
                    ),
                )
                // Phase 4 — Multi-source context indicator
                ContextSourcesIndicator(
                    state = activeSourcesState,
                    onClick = { showContextDashboard = true },
                )
            }
        },
    ) { innerPadding ->
        when (val state = uiState) {
            is ChatViewModel.ChatUiState.Loading -> {
                Box(
                    Modifier.fillMaxSize().padding(innerPadding),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = TealPrimary)
                }
            }

            is ChatViewModel.ChatUiState.Error -> {
                Box(
                    Modifier.fillMaxSize().padding(innerPadding),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                }
            }

            is ChatViewModel.ChatUiState.Success -> {
                ChatContent(
                    state = state,
                    listState = listState,
                    spenState = spenState,
                    isStylusConnected = isStylusConnected,
                    onSend = { viewModel.sendMessage(it) },
                    onStop = { viewModel.stopGeneration() },
                    onSpenCommitConsumed = { viewModel.resetSpenState() },
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .imePadding()
                        .navigationBarsPadding(),
                )
            }
        }
    }

    // Phase 4 — Context dashboard bottom sheet
    if (showContextDashboard) {
        ContextDashboardSheet(
            state = activeSourcesState,
            onDismiss = { showContextDashboard = false },
        )
    }
}

// ── Chat content ──────────────────────────────────────────────────────────────

@Composable
private fun ChatContent(
    state: ChatViewModel.ChatUiState.Success,
    listState: androidx.compose.foundation.lazy.LazyListState,
    spenState: SpenInputState,
    isStylusConnected: Boolean,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onSpenCommitConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var inputText by rememberSaveable { mutableStateOf("") }

    // Task 2 — when S Pen commits text, populate the input field
    LaunchedEffect(spenState) {
        if (spenState is SpenInputState.Committed) {
            inputText = spenState.text
            onSpenCommitConsumed()
        }
    }

    val isSpenActive = isStylusConnected || spenState is SpenInputState.Writing
    var stylusHovering by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val localView = LocalView.current

    Column(
        modifier = modifier
            // Task 2 — detect stylus hover events over the entire chat area
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        val isStylusEvent = event.changes.any { it.type == PointerType.Stylus }
                        if (isStylusEvent) {
                            val isHover = event.changes.all { !it.pressed }
                            if (isHover && event.type == PointerEventType.Move) {
                                stylusHovering = true
                                // Delegate handwriting recognition to the IME
                                // (Android 9+ / API 28+; full recognition on Samsung with API 33+)
                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                                    val imm = context.getSystemService(InputMethodManager::class.java)
                                    imm?.startStylusHandwriting(localView)
                                }
                            }
                            if (event.type == PointerEventType.Exit) {
                                stylusHovering = false
                            }
                        }
                    }
                }
            },
    ) {
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            state = listState,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(state.messages, key = { it.id }) { message ->
                MessageBubble(message = message)
            }
            if (state.streamingText.isNotEmpty()) {
                item(key = "streaming") {
                    StreamingBubble(text = state.streamingText)
                }
            }
            if (state.isGenerating && state.streamingText.isEmpty()) {
                item(key = "thinking") {
                    ThinkingBubble()
                }
            }
        }

        // Task 2 — S Pen hover overlay hint
        AnimatedVisibility(
            visible = stylusHovering && !state.isGenerating,
            enter = fadeIn(),
            exit = fadeOut(),
        ) {
            SpenHoverHint()
        }

        ChatInputBar(
            text = inputText,
            onTextChange = { inputText = it },
            isGenerating = state.isGenerating,
            isSpenActive = isSpenActive,
            onSend = {
                if (inputText.isNotBlank()) {
                    onSend(inputText.trim())
                    inputText = ""
                }
            },
            onStop = onStop,
        )
    }
}

// ── Task 2: S Pen hover hint banner ──────────────────────────────────────────

@Composable
private fun SpenHoverHint(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(TealPrimary.copy(alpha = 0.08f))
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Create,
            contentDescription = null,
            tint = TealPrimary,
            modifier = Modifier.size(16.dp),
        )
        Text(
            text = stringResource(R.string.chat_spen_hover_hint),
            style = MaterialTheme.typography.labelSmall,
            color = TealPrimary,
        )
    }
}

// ── Message bubbles ───────────────────────────────────────────────────────────

@Composable
private fun MessageBubble(message: Message, modifier: Modifier = Modifier) {
    val isUser = message.role == "user"
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp,
                    )
                )
                .background(if (isUser) TealDark else OledSurfaceVariant)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isUser) OledBlack else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun StreamingBubble(text: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp))
                .background(OledSurfaceVariant)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun ThinkingBubble(modifier: Modifier = Modifier) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp))
                .background(OledSurfaceVariant)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(12.dp),
                    color = TealPrimary,
                    strokeWidth = 2.dp,
                )
                Text(
                    text = stringResource(R.string.chat_thinking),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ── Input bar ─────────────────────────────────────────────────────────────────

@Composable
private fun ChatInputBar(
    text: String,
    onTextChange: (String) -> Unit,
    isGenerating: Boolean,
    isSpenActive: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = OledSurface,
        tonalElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Task 2 — teal pen icon when S Pen is active input mode
            AnimatedVisibility(visible = isSpenActive) {
                Icon(
                    imageVector = Icons.Filled.Create,
                    contentDescription = stringResource(R.string.chat_spen_mode_label),
                    tint = TealPrimary,
                    modifier = Modifier
                        .size(20.dp)
                        .padding(end = 4.dp),
                )
            }

            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text(
                        if (isSpenActive) stringResource(R.string.chat_spen_input_hint)
                        else stringResource(R.string.chat_input_hint)
                    )
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Send,
                ),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
                maxLines = 6,
                enabled = !isGenerating,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = if (isSpenActive) TealPrimary else TealPrimary,
                    unfocusedBorderColor = if (isSpenActive) TealPrimary.copy(alpha = 0.5f)
                    else MaterialTheme.colorScheme.outline,
                    cursorColor = TealPrimary,
                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
            Spacer(Modifier.size(8.dp))
            if (isGenerating) {
                IconButton(onClick = onStop) {
                    Icon(
                        Icons.Filled.Stop,
                        contentDescription = stringResource(R.string.chat_stop),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            } else {
                IconButton(
                    onClick = onSend,
                    enabled = text.isNotBlank(),
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.chat_send),
                        tint = if (text.isNotBlank()) TealPrimary else MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }
    }
}
