// Read-only runtime review: executes handlers extracted from the current source.
// Run from repo root with node --experimental-transform-types tests/touch-takeover.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three/webgpu';
import { TouchOrbit, FramePointerInput } from '../lib/touch-orbit.ts';
import { StudioCandies } from '../lib/studio-candies.ts';
import { characterFixture } from './softbody-fixture.mjs';

const source = readFileSync(
  new URL('../lib/studio-scene.ts', import.meta.url),
  'utf8',
);
function section(start, end) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Cannot locate source handlers: ${start}`);
  return source.slice(a, b);
}
const handlers = section(
  '    const down = (e: PointerEvent) => {',
  '    const wheel',
);
const trayMethods = section(
  '      beginCandy(kind, event, owner) {',
  '      clearCandies() {',
);
const cancelHandler = section(
  '    const cancelDrag = () => {',
  '    const visibilityChange',
);
// The harness executes only checked-in handlers, never page or user input.
// oxlint-disable-next-line typescript/no-implied-eval
const factory = new Function(
  'THREE',
  'TouchOrbit',
  'canvas',
  'candies',
  'volume',
  'playMode',
  'FramePointerInput',
  'locked',
  ts.transpile(
    `
let pointer = null, orbitGesture = false, cameraQuiet = 0;
let targetZoom = 1, targetYaw = 0, targetPitch = .12, lastX = 0, lastY = 0;
let yaw = 0, pitch = .12, zoom = 1;
const fixedCamera = () => locked;
const pointerMoves = new FramePointerInput();
const queueMove = (e) => pointerMoves.push(e);
const touches = new TouchOrbit(), contactStudy = null;
const callbacks = {onViewChange(){}}, resetMeasurement = () => {}, notifyCandyCount = () => {};
${handlers}
${cancelHandler}
const handle = {${trayMethods}};
return {down, move, up, cancelDrag, handle, queueMove, flush: () => pointerMoves.flush(move),
  state: () => ({orbitGesture, touches: [...touches.ids], pointer,
    targetZoom, targetYaw, targetPitch, held: candies.held, heldId: candies.world.heldId})};
`,
    { target: ts.ScriptTarget.ES2022 },
  ),
);

class CaptureManager {
  owners = new Map();
  queue = [];
  constructor(synchronous) {
    this.synchronous = synchronous;
  }
  loss(surface, id) {
    const dispatch = () =>
      surface.dispatchEvent(
        Object.assign(new Event('lostpointercapture'), {
          pointerId: id,
          pointerType: 'touch',
          clientX: 0,
          clientY: 0,
        }),
      );
    if (this.synchronous) dispatch();
    else this.queue.push(dispatch);
  }
  set(surface, id) {
    const previous = this.owners.get(id);
    this.owners.set(id, surface);
    if (previous && previous !== surface) this.loss(previous, id);
  }
  release(surface, id) {
    if (this.owners.get(id) !== surface) return;
    this.owners.delete(id);
    this.loss(surface, id);
  }
  flush() {
    while (this.queue.length) this.queue.shift()();
  }
  snapshot() {
    return [...this.owners].map(([id, owner]) => [id, owner.name]);
  }
}
class Surface extends EventTarget {
  style = {};
  constructor(name, captures) {
    super();
    this.name = name;
    this.captures = captures;
  }
  setPointerCapture(id) {
    this.captures.set(this, id);
  }
  hasPointerCapture(id) {
    return this.captures.owners.get(id) === this;
  }
  releasePointerCapture(id) {
    this.captures.release(this, id);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
}
function setup(synchronous, playMode = 'free', locked = false) {
  const captures = new CaptureManager(synchronous);
  const canvas = new Surface('canvas', captures),
    tray = new Surface('tray', captures);
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const candies = new StudioCandies(
    canvas,
    camera,
    new THREE.Scene(),
    new THREE.Mesh(characterFixture().body),
  );
  const counts = { cancel: 0, move: 0, release: [], taps: 0 };
  const cancel = candies.cancel.bind(candies),
    move = candies.move.bind(candies);
  candies.cancel = () => {
    counts.cancel++;
    return cancel();
  };
  candies.move = (event) => {
    counts.move++;
    return move(event);
  };
  candies.onTap = () => counts.taps++;
  candies.onHandRelease = (cancelled) => {
    counts.release.push(cancelled);
    const c = candies.world.get(candies.world.heldId);
    if (c) {
      c.contactHeld = false;
      c.mode = cancelled ? 'free' : 'merging';
    }
  };
  const volume = {
    held: false,
    cancel() {
      this.held = false;
    },
    pointerLeave() {},
    pointerDown() {
      return false;
    },
    pointerMove() {
      return false;
    },
    pointerUp() {
      return false;
    },
  };
  const h = factory(
    THREE,
    TouchOrbit,
    canvas,
    candies,
    volume,
    playMode,
    FramePointerInput,
    locked,
  );
  canvas.addEventListener('lostpointercapture', h.up);
  // Models the tray's React onLostPointerCapture forwarding cancellation to its handle.
  tray.addEventListener('lostpointercapture', (event) =>
    h.handle.releaseCandy(event, true),
  );
  const ev = (id, x, type = 'pointermove', time = 100, target = canvas) => ({
    pointerId: id,
    pointerType: 'touch',
    button: type === 'pointerdown' ? 0 : -1,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x,
    clientY: 220,
    timeStamp: time,
    type,
    currentTarget: target,
    preventDefault() {},
  });
  const startTray = (id = 1) => {
    const event = ev(id, 400, 'pointermove', 100, tray);
    assert.equal(h.handle.beginCandy('cube', event, tray), true);
    captures.flush();
    return candies.world.candies[0];
  };
  const release = (event, viaTray = false) => {
    if (viaTray) h.handle.releaseCandy(event, event.type !== 'pointerup');
    else h.up(event);
    // Pointerup/cancel implicitly releases any remaining browser capture.
    const owner = captures.owners.get(event.pointerId);
    if (owner) captures.release(owner, event.pointerId);
    captures.flush();
  };
  const clean = () => {
    assert.equal(h.state().orbitGesture, false);
    assert.deepEqual(h.state().touches, []);
    assert.equal(candies.held, false);
    assert.equal(candies.world.heldId, null);
    assert.deepEqual(captures.snapshot(), []);
  };
  return {
    h,
    volume,
    canvas,
    tray,
    candies,
    counts,
    captures,
    ev,
    startTray,
    release,
    clean,
  };
}

let passed = 0;
for (const synchronous of [false, true]) {
  for (const liftOrder of [
    [1, 2],
    [2, 1],
  ]) {
    const f = setup(synchronous),
      c = f.startTray();
    c.contactHeld = true;
    c.vx = 5;
    c.vy = 2;
    c.vz = 1;
    f.h.down(f.ev(2, 600, 'pointerdown'));
    f.captures.flush();
    assert.equal(f.h.state().orbitGesture, true);
    assert.deepEqual(f.h.state().touches, [1, 2]);
    assert.deepEqual(f.captures.snapshot(), [
      [1, 'canvas'],
      [2, 'canvas'],
    ]);
    assert.deepEqual(f.counts.release, [true]);
    assert.equal(c.mode, 'free');
    assert.deepEqual([c.vx, c.vy, c.vz], [0, 0, 0]);
    const moves = f.counts.move,
      before = f.h.state().targetZoom;
    f.h.move(f.ev(1, 420));
    // A late tray-forwarded move must also stay on the camera path.
    f.h.handle.moveCandy(f.ev(1, 425, 'pointermove', 130, f.tray));
    assert.notEqual(f.h.state().targetZoom, before);
    assert.equal(
      f.h.state().targetYaw,
      0,
      'two fingers zoom without orbit in either mode',
    );
    assert.equal(f.counts.move, moves);
    assert.equal(f.candies.world.candies.length, 1);
    f.release(f.ev(liftOrder[0], 450, 'pointerup'), liftOrder[0] === 1);
    assert.equal(f.h.state().orbitGesture, true);
    assert.equal(f.h.state().touches.length, 1);
    const partial = f.h.state().targetYaw;
    f.h.move(f.ev(liftOrder[1], 640));
    assert.equal(f.h.state().targetYaw, partial);
    f.release(f.ev(liftOrder[1], 640, 'pointerup'));
    f.h.move(f.ev(1, 700));
    assert.equal(f.counts.move, moves);
    f.clean();
    f.h.up(f.ev(1, 700, 'pointerup'));
    f.h.up(f.ev(2, 700, 'pointercancel'));
    f.clean();
    f.candies.dispose();
    passed++;
    console.log(
      `PASS takeover, capture loss ${synchronous ? 'sync' : 'deferred'}, lift order ${liftOrder.join(',')}`,
    );
  }
  const f = setup(synchronous);
  for (let i = 0; i < 3; i++) {
    if (i) f.candies.clear();
    f.startTray(10 + i * 2);
    f.h.down(f.ev(11 + i * 2, 600, 'pointerdown'));
    f.captures.flush();
    f.h.cancelDrag();
    f.captures.flush();
    f.clean();
    assert.equal(f.candies.world.candies.length, 1);
  }
  f.candies.dispose();
  passed++;
  console.log(
    `PASS repeated takeover + blur cleanup, capture loss ${synchronous ? 'sync' : 'deferred'}`,
  );
}

// Report adjacent entry ordering separately, without turning the requested handoff cases red.
for (const existingOrbit of [false, true]) {
  const f = setup(false);
  f.h.down(f.ev(20, 720, 'pointerdown'));
  if (existingOrbit) f.h.down(f.ev(21, 760, 'pointerdown'));
  assert.equal(
    f.h.handle.beginCandy(
      'cube',
      f.ev(22, 400, 'pointermove', 100, f.tray),
      f.tray,
    ),
    false,
  );
  f.captures.flush();
  assert.equal(f.candies.world.candies.length, 0);
  const snapshot = {
    existingOrbit,
    ...f.h.state(),
    captures: f.captures.snapshot(),
  };
  console.log('ADJACENT_ORDERING', JSON.stringify(snapshot));
  f.h.cancelDrag();
  f.captures.flush();
  f.candies.dispose();
}
for (const synchronous of [false, true]) {
  const f = setup(synchronous, 'tabletop');
  f.startTray();
  f.h.down(f.ev(2, 600, 'pointerdown'));
  f.captures.flush();
  const before = f.h.state();
  f.h.move(f.ev(1, 350));
  assert.notEqual(
    f.h.state().targetZoom,
    before.targetZoom,
    'pinch still changes distance',
  );
  assert.equal(
    f.h.state().targetYaw,
    before.targetYaw,
    'tabletop two-finger motion cannot orbit',
  );
  assert.equal(f.h.state().targetPitch, before.targetPitch);
  f.release(f.ev(1, 350, 'pointerup'));
  f.release(f.ev(2, 600, 'pointerup'));
  f.clean();
  f.candies.dispose();
  passed++;
}
for (const mode of ['free', 'tabletop']) {
  for (const firstLift of [31, 32]) {
    const f = setup(false, mode);
    let hits = 0;
    f.volume.pointerDown = () => {
      hits++;
      return false;
    };
    f.h.down(f.ev(31, 720, 'pointerdown'));
    f.h.move({ ...f.ev(31, 160), clientY: 280 });
    assert.ok(f.h.state().targetYaw > 3);
    assert.ok(f.h.state().targetPitch > 0.12);
    assert.equal(hits, 1, 'crossing the body cannot restart hit testing');
    const yaw = f.h.state().targetYaw,
      pitch = f.h.state().targetPitch;
    f.h.down(f.ev(32, 600, 'pointerdown'));
    assert.equal(
      f.h.state().pointer,
      null,
      'second finger promotes the background owner',
    );
    const zoom = f.h.state().targetZoom;
    f.h.move({ ...f.ev(31, 80), clientY: 300 });
    assert.notEqual(f.h.state().targetZoom, zoom);
    assert.equal(f.h.state().targetYaw, yaw);
    assert.equal(f.h.state().targetPitch, pitch);
    f.release(f.ev(firstLift, 100, 'pointerup'));
    const remaining = firstLift === 31 ? 32 : 31;
    f.h.move(f.ev(remaining, 0));
    assert.equal(
      f.h.state().targetYaw,
      yaw,
      'one remaining finger cannot resume rotation',
    );
    f.release(f.ev(remaining, 0, 'pointerup'));
    f.clean();
    // A new drag can continue around the back and complete a full revolution.
    f.h.down(f.ev(33, 720, 'pointerdown'));
    f.h.move(f.ev(33, 160));
    assert.ok(
      f.h.state().targetYaw > Math.PI * 2,
      'yaw is not clamped to a front-facing arc',
    );
    f.release(f.ev(33, 160, 'pointerup'));
    f.clean();
    f.candies.dispose();
    passed++;
  }
  const f = setup(true, mode);
  let bodyId = null;
  f.volume.pointerDown = (e) => {
    f.volume.held = true;
    bodyId = e.pointerId;
    f.canvas.setPointerCapture(bodyId);
    return true;
  };
  f.volume.pointerMove = () => f.volume.held;
  f.volume.cancel = () => {
    f.volume.held = false;
    if (bodyId !== null) f.canvas.releasePointerCapture(bodyId);
    bodyId = null;
  };
  f.h.down(f.ev(41, 400, 'pointerdown'));
  f.h.move(f.ev(41, 100));
  assert.equal(f.h.state().targetYaw, 0, 'a body drag cannot orbit');
  assert.equal(f.volume.held, true);
  f.h.down(f.ev(42, 600, 'pointerdown'));
  assert.equal(f.volume.held, false, 'pinch releases the body');
  f.h.move(f.ev(41, 50));
  assert.notEqual(f.h.state().targetZoom, 1);
  assert.equal(f.h.state().targetYaw, 0);
  f.release(f.ev(41, 50, 'pointerup'));
  f.release(f.ev(42, 600, 'pointerup'));
  f.clean();
  f.candies.dispose();
  passed++;
}
for (const synchronous of [false, true]) {
  const f = setup(synchronous, 'tabletop', true);
  f.h.down(f.ev(61, 720, 'pointerdown'));
  for (let i = 0; i < 240; i++) f.h.queueMove(f.ev(61, 720 - i));
  f.h.flush();
  assert.equal(
    f.h.state().targetYaw,
    0,
    'locked background drag cannot rotate',
  );
  assert.equal(f.h.state().targetPitch, 0.12);
  f.h.down(f.ev(62, 800, 'pointerdown'));
  f.h.queueMove(f.ev(62, 900));
  f.h.flush();
  assert.notEqual(
    f.h.state().targetZoom,
    1,
    'fixed camera still accepts pinch zoom',
  );
  f.release(f.ev(61, 480, 'pointerup'));
  f.release(f.ev(62, 900, 'pointerup'));
  f.clean();
  f.candies.dispose();
  passed++;
}
{
  const f = setup(false, 'tabletop', true);
  f.startTray();
  const before = f.counts.move;
  for (let i = 0; i < 100; i++)
    f.h.handle.moveCandy(f.ev(1, 400 + i, 'pointermove', 100 + i, f.tray));
  assert.equal(
    f.counts.move,
    before,
    'event burst does not repeatedly perform picking',
  );
  f.release(f.ev(1, 499, 'pointerup'), true);
  assert.equal(
    f.counts.move,
    before + 1,
    'release consumes final position exactly once',
  );
  f.h.flush();
  assert.equal(
    f.counts.move,
    before + 1,
    'no released input survives into next frame',
  );
  f.clean();
  f.candies.dispose();
  passed++;
}
console.log(
  `PASS ${passed} requested takeover lifecycle cases. This is an event harness, not browser-device QA.`,
);
