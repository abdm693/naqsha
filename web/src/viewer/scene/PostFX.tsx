import { useCallback } from "react";
import { useStore } from "zustand";
import { Bloom, EffectComposer, N8AO, Outline, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode, type EffectComposer as EffectComposerImpl, type OutlineEffect } from "postprocessing";
import type { ViewerController } from "../core/controller";

/**
 * N8AO (interiors-tuned) → SMAA → subtle Bloom for emissive lights → hover Outline → AgX tone mapping LAST
 * (EffectComposer forces renderer.toneMapping = NoToneMapping while mounted). "performance" drops AO.
 */
export function PostFX({ ctrl }: { ctrl: ViewerController }) {
  const quality = useStore(ctrl.store, (s) => s.quality);
  const mode = useStore(ctrl.store, (s) => s.mode);
  const composerRef = useCallback((c: EffectComposerImpl | null) => void (ctrl.composer = c), [ctrl]);
  const outlineRef = useCallback(
    (o: OutlineEffect | null) => {
      ctrl.outline = o;
    },
    [ctrl],
  );
  const walk = mode === "walk";
  return (
    <EffectComposer ref={composerRef} multisampling={0} autoClear={false}>
      <N8AO
        enabled={quality !== "performance"}
        halfRes={quality !== "high"}
        quality={quality === "high" ? "medium" : "low"}
        aoRadius={walk ? 0.6 : 1.6}
        distanceFalloff={walk ? 0.8 : 1.2}
        intensity={walk ? 2.3 : 3.2}
        color="black"
      />
      <SMAA />
      <Bloom mipmapBlur intensity={0.32} luminanceThreshold={1.1} luminanceSmoothing={0.3} radius={0.6} />
      <Outline ref={outlineRef} visibleEdgeColor={0x7d93ff} hiddenEdgeColor={0x7d93ff} edgeStrength={5} blur xRay={false} pulseSpeed={0} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}
