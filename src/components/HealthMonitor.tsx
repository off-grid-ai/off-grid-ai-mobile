/**
 * HealthMonitor — floating RAM usage indicator.
 *
 * Shows a compact pill in the top-right corner of the screen with
 * real-time RAM usage. Color-coded:
 *   green  →  < 60% usage (safe)
 *   yellow →  60-80% (warning)
 *   red    →  > 80% (critical)
 *
 * Tappable to expand into a detail view showing breakdown.
 * Auto-hides after 5 seconds of inactivity, reappears on tap or
 * when a generation starts.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { useMemoryMonitor, type MemorySnapshot } from '../hooks/useMemoryMonitor';
import { useAppStore } from '../stores';

// ---------------------------------------------------------------------------
// Severity colours
// ---------------------------------------------------------------------------

const SEVERITY_COLORS = {
  safe: '#22C55E',
  warning: '#F59E0B',
  critical: '#EF4444',
} as const;

const SEVERITY_BG = {
  safe: 'rgba(34, 197, 94, 0.12)',
  warning: 'rgba(245, 158, 11, 0.12)',
  critical: 'rgba(239, 68, 68, 0.15)',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AUTO_HIDE_MS = 5000;

export const HealthMonitor: React.FC = () => {
  const showHealthMonitor = useAppStore((s) => s.settings.showHealthMonitor);
  const isGenerating = useAppStore((s) => s.isGeneratingImage);
  const snapshot = useMemoryMonitor(showHealthMonitor);

  const [expanded, setExpanded] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0.35,
        duration: 600,
        useNativeDriver: true,
      }).start();
    }, AUTO_HIDE_MS);
  }, [opacity]);

  const reveal = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  }, [opacity, scheduleHide]);

  // Show on generation start
  useEffect(() => {
    if (isGenerating) reveal();
  }, [isGenerating, reveal]);

  // Auto-hide timer on mount
  useEffect(() => {
    if (showHealthMonitor) scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showHealthMonitor, scheduleHide]);

  if (!showHealthMonitor || !snapshot) return null;

  const handlePress = () => {
    reveal();
    setExpanded((v) => !v);
  };

  const color = SEVERITY_COLORS[snapshot.severity];
  const bgColor = SEVERITY_BG[snapshot.severity];
  const pct = Math.round(snapshot.usageRatio * 100);
  const barWidth = `${Math.min(pct, 100)}%`;

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.pill, { backgroundColor: bgColor, borderColor: color }]}
        onPress={handlePress}
        activeOpacity={0.7}
        testID="health-monitor-pill"
      >
        <View style={styles.pillContent}>
          <Text style={[styles.label, { color }]}>RAM</Text>
          <Text style={[styles.value, { color }]}>
            {snapshot.usedGB.toFixed(1)}/{snapshot.totalGB.toFixed(0)}
          </Text>
        </View>

        {/* Mini bar */}
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: barWidth as any, backgroundColor: color }]} />
        </View>

        {expanded && <ExpandedDetail snapshot={snapshot} color={color} pct={pct} />}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ---------------------------------------------------------------------------
// Expanded detail sub-component
// ---------------------------------------------------------------------------

const ExpandedDetail: React.FC<{
  snapshot: MemorySnapshot;
  color: string;
  pct: number;
}> = ({ snapshot, color, pct }) => (
  <View style={styles.detail}>
    <DetailRow label="Used" value={`${snapshot.usedGB.toFixed(1)} GB`} color={color} />
    <DetailRow label="Free" value={`${snapshot.availableGB.toFixed(1)} GB`} color="#94A3B8" />
    <DetailRow label="Total" value={`${snapshot.totalGB.toFixed(1)} GB`} color="#94A3B8" />
    <DetailRow label="Usage" value={`${pct}%`} color={color} />
  </View>
);

const DetailRow: React.FC<{
  label: string;
  value: string;
  color: string;
}> = ({ label, value, color }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, { color }]}>{value}</Text>
  </View>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TRACK_BG = 'rgba(255,255,255,0.08)';
const DETAIL_BORDER = 'rgba(255,255,255,0.1)';
const LABEL_COLOR = '#64748B';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 52,
    right: 12,
    zIndex: 9999,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 90,
  },
  pillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  label: {
    fontSize: 9,
    fontFamily: 'Menlo',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 10,
    fontFamily: 'Menlo',
    fontWeight: '400',
  },
  barTrack: {
    height: 3,
    backgroundColor: TRACK_BG,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    borderRadius: 2,
  },
  detail: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DETAIL_BORDER,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  detailLabel: {
    fontSize: 9,
    fontFamily: 'Menlo',
    color: LABEL_COLOR,
  },
  detailValue: {
    fontSize: 9,
    fontFamily: 'Menlo',
    fontWeight: '500',
  },
});
