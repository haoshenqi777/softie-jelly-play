'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PLAY_PIGMENTS, type PigmentId } from '@/lib/studio-pigment';

/** Static inspection of the exact product geometry and shaders. */
export default function CandyMaterials() {
  const host = useRef<HTMLDivElement>(null);
  const [shade, setShade] = useState<PigmentId>('peach');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let release = () => {};
    setError('');
    void (async () => {
      const THREE = await import('three/webgpu');
      const { CandyRenderer } = await import('@/lib/candy-renderer');
      const { CandyWorld } = await import('@/lib/candy-physics');
      const { createStudioEnvironment } = await import('@/lib/studio-material');
      const { OrbitControls } =
        await import('three/addons/controls/OrbitControls.js');
      if (disposed) return;
      const renderer = new THREE.WebGPURenderer({ antialias: true });
      await renderer.init();
      if (disposed) {
        renderer.dispose();
        return;
      }
      if (
        !(renderer.backend as unknown as { isWebGPUBackend?: boolean })
          .isWebGPUBackend
      ) {
        renderer.dispose();
        throw new Error('需要支持 WebGPU 的浏览器。');
      }
      const el = host.current!;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#f4f5f4');
      const environment = createStudioEnvironment(renderer);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.8;
      scene.add(new THREE.HemisphereLight('#fff8ee', '#9e7d78', 0.38));
      const key = new THREE.DirectionalLight('#fff8f1', 2.5);
      key.position.set(-3, 5, 4);
      scene.add(key);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshStandardNodeMaterial({
          color: '#f5f4f1',
          roughness: 0.55,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
      camera.position.set(0, 0.92, 2.15);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.13, 0);
      controls.enablePan = false;
      controls.minDistance = 1.05;
      controls.maxDistance = 3.5;
      controls.maxPolarAngle = Math.PI / 2 - 0.04;
      const world = new CandyWorld(),
        candies = new CandyRenderer(scene);
      const hex = PLAY_PIGMENTS.find((p) => p.id === shade)!.swatch;
      const cube = world.spawn(
        hex,
        'cube',
        { x: -0.34, y: 0.18, z: 0 },
        undefined,
        0.18,
      );
      cube.rx = cube.rz = 0;
      cube.ry = 0.35;
      const round = world.spawn(
        hex,
        'round',
        { x: 0.34, y: 0.18, z: 0 },
        undefined,
        0.18,
      );
      round.rx = 0.2;
      candies.update(world.candies);
      const resize = new ResizeObserver(() => {
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
        draw();
      });
      controls.update();
      function draw() {
        renderer.render(scene, camera);
      }
      controls.addEventListener('change', draw);
      resize.observe(el);
      release = () => {
        resize.disconnect();
        controls.removeEventListener('change', draw);
        controls.dispose();
        candies.dispose();
        floor.geometry.dispose();
        floor.material.dispose();
        environment.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch((e) => {
      if (!disposed) setError(e instanceof Error ? e.message : '样片加载失败');
    });
    return () => {
      disposed = true;
      release();
    };
  }, [shade]);
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f4f5f4',
        color: '#31362d',
        padding: '28px clamp(16px,4vw,60px)',
      }}
    >
      <Link href="/softbody">← 回到 Softie</Link>
      <h1 style={{ fontSize: 'clamp(30px,4vw,54px)', margin: '28px 0 10px' }}>
        一颗糖，也值得细看。
      </h1>
      <p>方糖 · 细糖晶　／　圆糖 · 亮糖壳。拖动转角度，滚轮靠近。</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 22 }}>
        {PLAY_PIGMENTS.map((p) => (
          <button
            key={p.id}
            aria-pressed={shade === p.id}
            onClick={() => setShade(p.id)}
            style={{
              padding: '8px 13px',
              borderRadius: 20,
              border: shade === p.id ? '1px solid #555' : '1px solid #ddd',
              background: '#fff',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: p.swatch,
                marginRight: 7,
              }}
            />
            {p.label}
          </button>
        ))}
      </div>
      <div
        ref={host}
        role="img"
        aria-label="WebGPU 方糖与圆糖材质对照"
        style={{ height: 'min(65vh,680px)', minHeight: 320, marginTop: 20 }}
      />
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
