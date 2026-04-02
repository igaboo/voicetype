<script lang="ts">
  /**
   * Lava lamp gradient using CSS radial-gradients.
   * Blobs slide up from off-screen by animating their Y% position directly.
   */

  let { energy = 0.5, visible = true, celebrating = false }: { energy?: number; visible?: boolean; celebrating?: boolean } = $props();

  let t = $state(0);
  let slideOffset = $state(40); // starts 60% below — off screen
  let fadeOpacity = $state(0);
  let animId = 0;
  let startTime = 0;
  let prevVisible = false;
  let slideStart = 0;
  let slideFrom = 60;
  let slideTo = 0;
  const SLIDE_DURATION = 1000; // ms

  const blobs = [
    { color: '147, 51, 234',  offsetX: -8,  offsetY: -3,  size: 220, scale: 1.0  },
    { color: '59, 130, 246',  offsetX:  5,  offsetY:  2,  size: 260, scale: 0.9  },
    { color: '34, 211, 238',  offsetX: -4,  offsetY:  4,  size: 190, scale: 0.85 },
    { color: '99, 102, 241',  offsetX:  7,  offsetY: -2,  size: 240, scale: 0.9  },
  ];

  // Celebration phase — smoothly ramps up then back down over 3s
  let celebrationPhase = $state(0);
  let celebrationStart = 0;
  const CELEBRATION_DURATION = 3000;

  $effect(() => {
    if (celebrating && celebrationStart === 0) {
      celebrationStart = performance.now();
    } else if (!celebrating) {
      celebrationStart = 0;
      celebrationPhase = 0;
    }
  });

  let blobStyles = $derived.by(() => {
    const groupX = Math.cos(t * 0.2) * 6;
    const groupY = Math.sin(t * 0.15) * 3;

    // Celebration: blobs orbit outward then return (sin envelope over 4pi)
    const envelope = celebrationPhase > 0 ? Math.max(0, Math.sin(celebrationPhase / 4)) : 0;
    const orbitR = 25 * envelope; // radius in percent units

    return blobs.map((b, i) => {
      const wiggleX = Math.sin(t * (0.35 + i * 0.1) + i * 1.5) * 3;
      const wiggleY = Math.cos(t * (0.25 + i * 0.08) + i * 2.0) * 2;

      // Celebration orbit offset for each blob at different quadrants
      const angle = celebrationPhase + i * Math.PI * 0.5;
      const orbitX = Math.cos(angle) * orbitR;
      const orbitY = Math.sin(angle) * orbitR;

      const x = 50 + groupX + b.offsetX + wiggleX + orbitX;
      // slideOffset drives the vertical entrance/exit
      const y = 90 + groupY + b.offsetY + wiggleY + slideOffset + orbitY;

      const alpha = 0.7 * b.scale;
      return `radial-gradient(ellipse ${b.size}px ${b.size * 0.55}px at ${x}% ${y}%, rgba(${b.color}, ${alpha.toFixed(2)}) 0%, rgba(${b.color}, 0) 70%)`;
    });
  });

  // Easing function (ease-out cubic)
  function easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function loop(timestamp: number) {
    if (!startTime) startTime = timestamp;
    t = (timestamp - startTime) / 1000;

    // Drive celebration phase (ramps linearly from 0 to 4pi over 3s)
    if (celebrationStart > 0) {
      const elapsed = timestamp - celebrationStart;
      const progress = Math.min(elapsed / CELEBRATION_DURATION, 1);
      celebrationPhase = progress * Math.PI * 4;
      if (progress >= 1) {
        celebrationStart = 0;
        celebrationPhase = 0;
      }
    }

    // Animate slideOffset + fadeOpacity
    if (slideStart > 0) {
      const elapsed = timestamp - slideStart;
      const progress = Math.min(elapsed / SLIDE_DURATION, 1);
      slideOffset = slideFrom + (slideTo - slideFrom) * easeOut(progress);

      // Fade: ramp in first 150ms, ramp out last 150ms
      if (slideTo === 0) {
        // Sliding IN — fade 0→1 in first 150ms
        fadeOpacity = Math.min(elapsed / 150, 1);
      } else {
        // Sliding OUT — fade 1→0 in last 150ms
        const remaining = SLIDE_DURATION - elapsed;
        fadeOpacity = Math.min(remaining / 150, 1);
      }

      if (progress >= 1) {
        slideStart = 0;
        fadeOpacity = slideTo === 0 ? 1 : 0;
      }
    }

    animId = requestAnimationFrame(loop);
  }

  $effect(() => {
    if (visible && !prevVisible) {
      // Slide IN: from 60% below to 0
      slideFrom = slideOffset; // start from wherever we are
      slideTo = 0;
      slideStart = performance.now();
    } else if (!visible && prevVisible) {
      // Slide OUT: from current to 60% below
      slideFrom = slideOffset;
      slideTo = 40;
      slideStart = performance.now();
    }
    prevVisible = visible;
  });

  $effect(() => {
    startTime = 0;
    slideOffset = visible ? 60 : 60; // start off-screen
    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  });
</script>

<div
  class="lava-lamp"
  style="background: {blobStyles.join(', ')}; opacity: {fadeOpacity};"
></div>

<style>
  .lava-lamp {
    position: absolute;
    inset: -40px;
    pointer-events: none;
    filter: blur(40px);
  }
</style>
