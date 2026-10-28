import { useLayoutEffect } from "react";
import type * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ViewerController } from "../core/controller";

/** Hands the R3F renderer/scene/camera to the controller and drives its per-frame update (priority 0). */
export function SceneRoot({ ctrl }: { ctrl: ViewerController }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    ctrl.attachThree({ gl, scene, camera: camera as THREE.PerspectiveCamera, invalidate: () => invalidate() });
    return () => ctrl.detachThree();
  }, [ctrl, gl, scene, camera, invalidate]);

  // runs after CameraControls (−1) and before the EffectComposer renders (1)
  useFrame((_, dt) => ctrl.frame(dt), 0);
  return null;
}
