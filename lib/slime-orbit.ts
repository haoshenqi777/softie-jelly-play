import { Plane, Vector3, type Camera, type PerspectiveCamera } from 'three';
import { heightAt, radiusAt } from './slime-shape.ts';
import type { SlimeDynamics } from './slime-physics';
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const homePitch = Math.atan(0.145);
export class SlimeOrbit {
  yaw = 0;
  pitch = homePitch;
  distanceScale = 1;
  private targetYaw = 0;
  private targetPitch = homePitch;
  private targetDistance = 1;
  rotate(yaw: number, pitch: number) {
    this.targetYaw += yaw;
    this.targetPitch = clamp(this.targetPitch + pitch, 0.12, 1.12);
  }
  zoom(delta: number) {
    this.targetDistance = clamp(
      this.targetDistance * Math.exp(delta),
      0.85,
      1.6,
    );
  }
  freeze() {
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetDistance = this.distanceScale;
  }
  home() {
    this.targetYaw =
      this.yaw - Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.targetPitch = homePitch;
    this.targetDistance = 1;
  }
  advance(dt: number) {
    const weight = 1 - Math.exp(-Math.min(0.1, dt) * 9);
    this.yaw += (this.targetYaw - this.yaw) * weight;
    this.pitch += (this.targetPitch - this.pitch) * weight;
    this.distanceScale += (this.targetDistance - this.distanceScale) * weight;
  }
}
export function grabPlane(camera: Camera, point: Vector3, out = new Plane()) {
  return out.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new Vector3()),
    point,
  );
}

const framingPoints = Array.from({ length: 33 * 12 }, (_, i) => {
  const t = -Math.cos((Math.floor(i / 12) * Math.PI) / 32),
    a = ((i % 12) * Math.PI) / 6;
  return {
    x: 1.64 * radiusAt(t) * Math.cos(a),
    y: heightAt(t),
    z: 1.18 * radiusAt(t) * Math.sin(a),
  };
});
const framingPoint = new Vector3();
export function fitSlimeZoom(
  camera: PerspectiveCamera,
  physics: SlimeDynamics,
) {
  const tangent = Math.tan((camera.fov * Math.PI) / 360);
  let extent = 0.01;
  for (const rest of framingPoints) {
    physics.deform(rest.x, rest.y, rest.z, framingPoint);
    framingPoint.x += physics.x;
    framingPoint.y += physics.y;
    framingPoint.z += physics.z;
    framingPoint.applyMatrix4(camera.matrixWorldInverse);
    const halfHeight = Math.max(0.1, -framingPoint.z) * tangent;
    extent = Math.max(
      extent,
      Math.abs(framingPoint.x) / (halfHeight * camera.aspect),
      Math.abs(framingPoint.y) / halfHeight,
    );
  }
  return Math.min(1, 0.92 / extent);
}
