/**
 * useMemoryMonitor — polls device memory at a fixed interval and
 * exposes real-time RAM usage for the HealthMonitor overlay.
 *
 * Only polls while active. Automatically pauses when the hook unmounts.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { hardwareService } from '../services/hardware';

export interface MemorySnapshot {
  usedGB: number;
  totalGB: number;
  availableGB: number;
  /** 0–1 ratio of used/total */
  usageRatio: number;
  /** 'safe' | 'warning' | 'critical' */
  severity: 'safe' | 'warning' | 'critical';
}

const POLL_INTERVAL_MS = 3000;
const WARNING_THRESHOLD = 0.60;
const CRITICAL_THRESHOLD = 0.80;

function classify(ratio: number): MemorySnapshot['severity'] {
  if (ratio >= CRITICAL_THRESHOLD) return 'critical';
  if (ratio >= WARNING_THRESHOLD) return 'warning';
  return 'safe';
}

export function useMemoryMonitor(enabled: boolean = true): MemorySnapshot | null {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const info = await hardwareService.refreshMemoryInfo();
      const totalGB = info.totalMemory / (1024 * 1024 * 1024);
      const usedGB = info.usedMemory / (1024 * 1024 * 1024);
      const availableGB = totalGB - usedGB;
      const usageRatio = totalGB > 0 ? usedGB / totalGB : 0;

      setSnapshot({
        usedGB,
        totalGB,
        availableGB,
        usageRatio,
        severity: classify(usageRatio),
      });
    } catch {
      // Silently ignore — don't crash the UI for a monitoring failure
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Immediate first poll
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, poll]);

  return snapshot;
}
