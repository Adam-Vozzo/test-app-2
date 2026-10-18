// Vibration feedback where supported (Android browsers). iOS Safari has no vibration API,
// so every call degrades to a no-op there.

export const haptics = {
  enabled: true,
  supported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  last: 0,

  pulse(pattern, minGapMs = 70) {
    if (!this.enabled || !this.supported) return;
    const now = performance.now();
    if (now - this.last < minGapMs) return;
    this.last = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some browsers throw when not triggered by a gesture */
    }
  },
};
