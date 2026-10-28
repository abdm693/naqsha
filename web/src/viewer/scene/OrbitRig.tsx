import { useCallback } from "react";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import type { SuspendableControls, ViewerController } from "../core/controller";

/** camera-controls writes the camera on every update(); while walking we suspend it instead of unmounting. */
class SuspendableCameraControls extends CameraControlsImpl {
  suspended = false;
  override update(delta: number): boolean {
    if (this.suspended) return false;
    return super.update(delta);
  }
}

export function OrbitRig({ ctrl }: { ctrl: ViewerController }) {
  const ref = useCallback((c: CameraControlsImpl | null) => ctrl.attachControls(c as SuspendableControls | null), [ctrl]);
  return <CameraControls impl={SuspendableCameraControls} ref={ref} makeDefault />;
}
