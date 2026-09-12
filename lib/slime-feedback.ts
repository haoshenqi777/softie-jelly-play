import * as THREE from 'three/webgpu';
import { float, normalView, positionView, uniform } from 'three/tsl';
import { BubbleWorld, type BubbleKind } from './bubble-world';
import type { Point3 } from './candy-physics';

export class SlimeFeedback {
  readonly world = new BubbleWorld();
  private scene: THREE.Scene;
  private geometry = new THREE.SphereGeometry(1, 24, 16);
  private heart: THREE.ExtrudeGeometry;
  private star: THREE.ExtrudeGeometry;
  private iconMaterials = {
    heart: new THREE.MeshPhysicalNodeMaterial({
      color: '#ef95b6',
      roughness: 0.2,
      clearcoat: 1,
    }),
    star: new THREE.MeshPhysicalNodeMaterial({
      color: '#eacb85',
      roughness: 0.2,
      clearcoat: 1,
    }),
  };
  private pieces = new Map<number, ReturnType<SlimeFeedback['makePiece']>>();
  private sleepPiece: ReturnType<SlimeFeedback['makePiece']>;
  private sleepPopped = false;
  private sleepPopAge = 0;
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.5);
    heart.bezierCurveTo(-0.9, 0.03, -0.65, 0.85, 0, 0.4);
    heart.bezierCurveTo(0.65, 0.85, 0.9, 0.03, 0, -0.5);
    this.heart = new THREE.ExtrudeGeometry(heart, {
      depth: 0.12,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.06,
      bevelThickness: 0.04,
      curveSegments: 10,
    });
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.25 : 0.56,
        a = Math.PI * 0.5 + (i * Math.PI) / 5;
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      if (i === 0) star.moveTo(x, y);
      else star.lineTo(x, y);
    }
    star.closePath();
    this.star = new THREE.ExtrudeGeometry(star, {
      depth: 0.1,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.045,
      bevelThickness: 0.03,
    });
    this.sleepPiece = this.makePiece('heart');
    this.sleepPiece.icon.visible = false;
    this.sleepPiece.mesh.userData.sleepBubble = true;
    this.sleepPiece.group.visible = false;
  }
  private makePiece(kind: BubbleKind) {
    const alpha = uniform(1),
      view = normalView.dot(positionView.negate().normalize()).abs();
    const material = new THREE.MeshPhysicalNodeMaterial({
      color: '#fff3f8',
      roughness: 0.025,
      clearcoat: 1,
      envMapIntensity: 0.7,
      transparent: true,
      depthWrite: false,
    });
    material.opacityNode = float(1)
      .sub(view)
      .pow(2.5)
      .mul(0.5)
      .add(0.055)
      .mul(alpha);
    const group = new THREE.Group(),
      mesh = new THREE.Mesh(this.geometry, material);
    const icon = new THREE.Mesh(
      kind === 'heart' ? this.heart : this.star,
      this.iconMaterials[kind],
    );
    icon.scale.setScalar(0.75);
    icon.position.z = -0.02;
    group.add(mesh, icon);
    this.scene.add(group);
    return { group, mesh, icon, material, alpha };
  }
  get pickables() {
    return [...this.pieces.values()]
      .map((p) => p.mesh)
      .concat(this.sleepPiece.group.visible ? [this.sleepPiece.mesh] : []);
  }
  emit(kind: BubbleKind, p: Point3) {
    return this.world.emit(kind, p);
  }
  pop(id: number) {
    return this.world.pop(id);
  }
  popSleep() {
    this.sleepPopped = true;
    this.sleepPopAge = 0;
  }
  update(dt: number, sleep: number, sleepPosition: Point3, time: number) {
    this.world.advance(dt);
    const ids = new Set(this.world.bubbles.map((b) => b.id));
    for (const [id, p] of this.pieces)
      if (!ids.has(id)) {
        p.group.removeFromParent();
        p.material.dispose();
        this.pieces.delete(id);
      }
    for (const b of this.world.bubbles) {
      let p = this.pieces.get(b.id);
      if (!p) {
        p = this.makePiece(b.kind);
        p.mesh.userData.bubbleId = b.id;
        this.pieces.set(b.id, p);
      }
      const appear = Math.min(1, b.age / 0.18),
        fade = Math.min(1, (b.lifetime - b.age) / 0.5);
      const pop = b.popping ? Math.max(0, 1 - b.popAge / 0.22) : 1;
      p.group.position.set(b.x, b.y, b.z);
      p.group.scale.setScalar(
        (b.kind === 'heart' ? 0.145 : 0.12) *
          appear *
          (b.popping ? 0.6 + 0.4 * pop : 1),
      );
      p.group.rotation.z = Math.sin(b.age * 3 + b.id) * 0.1;
      p.alpha.value = fade * pop;
      p.icon.visible = !b.popping;
      p.icon.rotation.y = Math.sin(b.age * 2) * 0.18;
    }
    if (this.sleepPopped) this.sleepPopAge += dt;
    if (sleep < 0.1) this.sleepPopped = false;
    const sleepFade = Math.max(0, Math.min(1, (sleep - 0.5) * 2));
    const pop = this.sleepPopped ? Math.max(0, 1 - this.sleepPopAge / 0.2) : 1;
    this.sleepPiece.group.visible = sleepFade * pop > 0.01;
    this.sleepPiece.group.position.set(
      sleepPosition.x,
      sleepPosition.y,
      sleepPosition.z,
    );
    this.sleepPiece.group.scale.setScalar(
      (0.095 + 0.018 * Math.sin(time * 1.7)) * sleepFade * pop,
    );
    this.sleepPiece.alpha.value = sleepFade * pop;
  }
  reset() {
    this.world.reset();
    for (const p of this.pieces.values()) {
      p.group.removeFromParent();
      p.material.dispose();
    }
    this.pieces.clear();
    this.sleepPiece.group.visible = false;
    this.sleepPopped = false;
  }
  dispose() {
    this.reset();
    this.sleepPiece.group.removeFromParent();
    this.sleepPiece.material.dispose();
    this.geometry.dispose();
    this.heart.dispose();
    this.star.dispose();
    Object.values(this.iconMaterials).forEach((m) => m.dispose());
  }
}

export class SlimeAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private last = 0;
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.context ??= new AudioContext();
      void this.context.resume();
    }
  }
  play(kind: 'gummy' | 'hard' | 'pop' | 'swallow', strength = 1) {
    if (!this.enabled || !this.context) return;
    const ctx = this.context,
      now = ctx.currentTime;
    if (now - this.last < 0.1) return;
    this.last = now;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    const frequency = { gummy: 210, hard: 740, pop: 520, swallow: 130 }[kind];
    osc.type = kind === 'hard' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.4, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      Math.min(0.025, 0.009 + strength * 0.003),
      now + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    void this.context?.close();
    this.context = null;
  }
}
