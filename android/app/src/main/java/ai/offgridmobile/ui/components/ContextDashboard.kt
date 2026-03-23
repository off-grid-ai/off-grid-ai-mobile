package ai.offgridmobile.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BluetoothSearching
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.CellTower
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Loop
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.offgridmobile.R
import ai.offgridmobile.context.ActiveSourcesState
import ai.offgridmobile.ooda.OodaItem
import ai.offgridmobile.ooda.OodaPhase
import ai.offgridmobile.ui.theme.OledSurface
import ai.offgridmobile.ui.theme.TealPrimary
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// ── Context sources indicator bar ─────────────────────────────────────────────

/**
 * Compact teal bar shown below the TopAppBar when any context source is active.
 * Tapping opens the [ContextDashboardSheet] bottom sheet.
 *
 * Replaces the old single-source `AetherContextIndicator` with a unified
 * multi-source indicator that shows AETHER, CODEX, and OODA status.
 */
@Composable
fun ContextSourcesIndicator(
    state: ActiveSourcesState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!state.hasActiveSources) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(OledSurface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // AETHER indicator
        if (state.aetherEnabled && state.aetherSnapshot != null) {
            SourceChip(
                icon = { Icon(Icons.Filled.Wifi, null, tint = TealPrimary, modifier = Modifier.size(12.dp)) },
                label = stringResource(R.string.ctx_source_aether),
            )
        }

        // CODEX indicator
        if (state.codexEnabled && state.codexReachable) {
            SourceChip(
                icon = { Icon(Icons.Filled.Book, null, tint = TealPrimary, modifier = Modifier.size(12.dp)) },
                label = stringResource(R.string.ctx_source_codex),
            )
        }

        // OODA indicator
        if (state.oodaEnabled && state.oodaSnapshot != null && !state.oodaSnapshot.isEmpty) {
            SourceChip(
                icon = { Icon(Icons.Filled.Loop, null, tint = TealPrimary, modifier = Modifier.size(12.dp)) },
                label = stringResource(R.string.ctx_source_ooda),
            )
        }

        Spacer(Modifier.weight(1f))

        Icon(
            Icons.Filled.ExpandMore,
            contentDescription = null,
            tint = TealPrimary.copy(alpha = 0.6f),
            modifier = Modifier.size(14.dp),
        )
    }
}

@Composable
private fun SourceChip(
    icon: @Composable () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        icon()
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = TealPrimary,
        )
    }
}

// ── Context dashboard bottom sheet ────────────────────────────────────────────

/**
 * Full context dashboard shown in a bottom sheet.
 * Sections for AETHER RF, CODEX, and OODA — each collapsible.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextDashboardSheet(
    state: ActiveSourcesState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = OledSurface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = MaterialTheme.colorScheme.outline) },
    ) {
        ContextDashboardContent(
            state = state,
            onDismiss = onDismiss,
            modifier = modifier,
        )
    }
}

@Composable
private fun ContextDashboardContent(
    state: ActiveSourcesState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatter = remember {
        DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Filled.Hub, null, tint = TealPrimary, modifier = Modifier.size(20.dp))
                Text(
                    text = stringResource(R.string.ctx_dashboard_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = TealPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            IconButton(onClick = onDismiss) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(R.string.ctx_dashboard_close),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // ── AETHER section ────────────────────────────────────────────────────
        val aetherSnap = state.aetherSnapshot
        if (state.aetherEnabled && aetherSnap != null) {
            CollapsibleSection(
                icon = { Icon(Icons.Filled.Wifi, null, tint = TealPrimary, modifier = Modifier.size(16.dp)) },
                title = stringResource(R.string.ctx_section_aether),
                badge = aetherSnap.capturedAt.let { formatter.format(it) },
            ) {
                if (aetherSnap.wifiNetworks.isNotEmpty()) {
                    DashboardSubHeader(
                        icon = { Icon(Icons.Filled.Wifi, null, tint = TealPrimary, modifier = Modifier.size(13.dp)) },
                        title = stringResource(R.string.chat_aether_wifi_header, aetherSnap.wifiNetworks.size),
                    )
                    aetherSnap.wifiNetworks.take(5).forEach { net ->
                        DataRow(label = net.ssid.ifEmpty { net.bssid }, value = "${net.level} dBm")
                    }
                }
                if (aetherSnap.bluetoothDevices.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    DashboardSubHeader(
                        icon = { Icon(Icons.Filled.BluetoothSearching, null, tint = TealPrimary, modifier = Modifier.size(13.dp)) },
                        title = stringResource(R.string.chat_aether_bt_header, aetherSnap.bluetoothDevices.size),
                    )
                    aetherSnap.bluetoothDevices.take(4).forEach { dev ->
                        DataRow(label = dev.deviceName.ifEmpty { dev.address }, value = "${dev.rssi} dBm")
                    }
                }
                aetherSnap.cellularInfo?.let { cell ->
                    Spacer(Modifier.height(4.dp))
                    DashboardSubHeader(
                        icon = { Icon(Icons.Filled.CellTower, null, tint = TealPrimary, modifier = Modifier.size(13.dp)) },
                        title = stringResource(R.string.chat_aether_cellular_header),
                    )
                    DataRow(
                        label = "MCC ${cell.mcc} · MNC ${cell.mnc}",
                        value = "${cell.signalDbm} dBm",
                    )
                }
            }
        }

        // ── CODEX section ─────────────────────────────────────────────────────
        if (state.codexEnabled) {
            CollapsibleSection(
                icon = { Icon(Icons.Filled.Book, null, tint = TealPrimary, modifier = Modifier.size(16.dp)) },
                title = stringResource(R.string.ctx_section_codex),
                badge = if (state.codexReachable)
                    stringResource(R.string.ctx_codex_connected)
                else
                    stringResource(R.string.ctx_codex_offline),
                badgeColor = if (state.codexReachable) TealPrimary else MaterialTheme.colorScheme.error,
            ) {
                Text(
                    text = if (state.codexReachable)
                        stringResource(R.string.ctx_codex_ready)
                    else
                        stringResource(R.string.ctx_codex_offline_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }
        }

        // ── OODA section ──────────────────────────────────────────────────────
        val oodaSnap = state.oodaSnapshot
        if (state.oodaEnabled && oodaSnap != null && !oodaSnap.isEmpty) {
            CollapsibleSection(
                icon = { Icon(Icons.Filled.Loop, null, tint = TealPrimary, modifier = Modifier.size(16.dp)) },
                title = stringResource(R.string.ctx_section_ooda),
                badge = oodaSnap.activeCycle.ifEmpty { stringResource(R.string.ctx_ooda_unnamed_cycle) },
            ) {
                OodaPhaseBlock(stringResource(R.string.ctx_ooda_observe), oodaSnap.observations)
                OodaPhaseBlock(stringResource(R.string.ctx_ooda_orient), oodaSnap.orientations)
                OodaPhaseBlock(stringResource(R.string.ctx_ooda_decide), oodaSnap.decisions)
                OodaPhaseBlock(stringResource(R.string.ctx_ooda_act), oodaSnap.actions)
            }
        }
    }
}

// ── Shared composables ────────────────────────────────────────────────────────

@Composable
private fun CollapsibleSection(
    icon: @Composable () -> Unit,
    title: String,
    badge: String = "",
    badgeColor: androidx.compose.ui.graphics.Color = TealPrimary.copy(alpha = 0.7f),
    content: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(true) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            icon()
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                color = TealPrimary,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (badge.isNotEmpty()) {
                Text(
                    text = badge,
                    style = MaterialTheme.typography.labelSmall,
                    color = badgeColor,
                )
                Spacer(Modifier.width(4.dp))
            }
            Icon(
                imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }

        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 22.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                content()
            }
        }

        HorizontalDivider(
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun DashboardSubHeader(
    icon: @Composable () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.padding(bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        icon()
        Text(
            text = title,
            style = MaterialTheme.typography.labelSmall,
            color = TealPrimary,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun DataRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(start = 4.dp, bottom = 1.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun OodaPhaseBlock(
    phaseLabel: String,
    items: List<OodaItem>,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) return
    Column(modifier = modifier.padding(bottom = 4.dp)) {
        Text(
            text = phaseLabel,
            style = MaterialTheme.typography.labelSmall,
            color = TealPrimary.copy(alpha = 0.8f),
            fontWeight = FontWeight.Medium,
        )
        items.take(3).forEach { item ->
            Row(
                modifier = Modifier.padding(start = 8.dp, top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = if (item.priority >= 2) "!!" else "·",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (item.priority >= 2) MaterialTheme.colorScheme.error else TealPrimary,
                )
                Text(
                    text = item.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        if (items.size > 3) {
            Text(
                text = "+${items.size - 3} more",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 8.dp, top = 2.dp),
            )
        }
    }
}
