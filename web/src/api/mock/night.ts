/**
 * Mock "night" edit of a day image: the same camera, a blue-hour sky and warm light low on the facade.
 * (The live API edits the image with the image model; this only has to look plausible in demos.)
 */
const cache = new Map<string, Promise<string>>();

export function nightOf(url: string, maxW = 900): Promise<string> {
  const hit = cache.get(url);
  if (hit) return hit;
  const job = (async () => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return url;
    ctx.filter = "brightness(0.42) saturate(1.15) contrast(1.12) hue-rotate(-6deg)";
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = "none";
    // Blue-hour sky: deepen the top of the frame.
    ctx.globalCompositeOperation = "multiply";
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, "rgb(38 52 120)");
    sky.addColorStop(1, "rgb(255 255 255)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // Warm light spilling from the house: windows and the porch sit in the middle band.
    ctx.globalCompositeOperation = "screen";
    for (const [x, y, r, a] of [
      [0.5, 0.42, 0.36, 0.22],
      [0.32, 0.62, 0.18, 0.2],
      [0.66, 0.6, 0.2, 0.18],
    ] as const) {
      const g = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * r);
      g.addColorStop(0, `rgb(255 196 120 / ${a})`);
      g.addColorStop(1, "rgb(255 196 120 / 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
    return c.toDataURL("image/jpeg", 0.74);
  })().catch(() => url);
  cache.set(url, job);
  return job;
}
