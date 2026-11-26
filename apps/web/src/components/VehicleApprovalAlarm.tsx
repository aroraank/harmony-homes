import { useEffect, useRef } from 'react';
import { useVehicleApprovals } from '@/lib/vehicleGate';

/**
 * A distinct, attention-grabbing alert -- vibration + an audible alarm tone -- the moment a NEW guest
 * vehicle shows up waiting for this flat's gate approval, on top of the push notification. Mounted once
 * at the app shell so it fires from any page, not just Home (where the approval banner itself lives).
 *
 * Why not just rely on the push notification's own sound? The Web Push / Notification API has no way for
 * a site to choose a custom ringtone -- only the OS's own default notification sound plays, and only a
 * vibration *pattern* (not a sound) can be set from here. So on top of the vibration we already send in
 * the push payload (see sw.ts), this plays a real, loud, unmistakable siren-like tone whenever the app is
 * open (foreground or a background tab) -- which is the one place a site genuinely can make noise.
 */
let audioCtx: AudioContext | null = null;

function playAlarm() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    // Three rising "beep-beep-beep" bursts, like a gate alarm, not a soft chime.
    for (let burst = 0; burst < 3; burst++) {
      const start = now + burst * 0.45;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1046, start);
      osc.frequency.setValueAtTime(1318, start + 0.15);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    }
  } catch {
    /* best effort -- never block the UI over a sound */
  }
}

function vibrate() {
  try {
    navigator.vibrate?.([250, 120, 250, 120, 400]);
  } catch {
    /* unsupported on this device */
  }
}

export function VehicleApprovalAlarm({ societyId }: { societyId: string }) {
  const q = useVehicleApprovals(societyId);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    const ids = (q.data ?? []).map((v) => v.id);
    if (!primed.current) {
      // Don't alarm for approvals that were already waiting when the app opened -- only brand-new ones.
      seen.current = new Set(ids);
      primed.current = true;
      return;
    }
    const fresh = ids.filter((id) => !seen.current.has(id));
    if (fresh.length > 0) {
      playAlarm();
      vibrate();
    }
    seen.current = new Set(ids);
  }, [q.data]);

  return null;
}
