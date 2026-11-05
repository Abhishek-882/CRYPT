"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface ThreeParticleCanvasProps {
  particleCount?: number;
  className?: string;
}

export function ThreeParticleCanvas({
  particleCount = 120,
  className = "",
}: ThreeParticleCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer Setup
    const scene = new THREE.Scene();
    const width = Math.max(container.clientWidth || window.innerWidth, 320);
    const height = Math.max(container.clientHeight || 640, 320);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 50;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
    } catch {
      // Graceful fallback if WebGL is unavailable
      return;
    }

    // 2. High-Performance Particle Buffer Geometry (<150 particles for 60 FPS budget)
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    // Color palette: Emerald (Alpha yield) & Cyan (Order book telemetry)
    const emerald = new THREE.Color(0x10b981);
    const cyan = new THREE.Color(0x06b6d4);
    const amber = new THREE.Color(0xf59e0b);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 85;
      positions[i + 1] = (Math.random() - 0.5) * 65;
      positions[i + 2] = (Math.random() - 0.5) * 40;

      velocities[i] = (Math.random() - 0.5) * 0.035;
      velocities[i + 1] = (Math.random() - 0.5) * 0.035;
      velocities[i + 2] = (Math.random() - 0.5) * 0.015;

      const rand = Math.random();
      const col = rand > 0.6 ? emerald : rand > 0.2 ? cyan : amber;
      colors[i] = col.r;
      colors[i + 1] = col.g;
      colors[i + 2] = col.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Particle Shader Material with Additive Blending
    const material = new THREE.PointsMaterial({
      size: 1.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // 3. Animation Loop with Pause-on-Blur to preserve GPU
    let animationFrameId: number;
    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      if (document.hidden) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      animationFrameId = requestAnimationFrame(animate);

      const pos = geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount * 3; i += 3) {
        pos[i] += velocities[i];
        pos[i + 1] += velocities[i + 1];

        // Boundary bounce inside viewport frustum
        if (Math.abs(pos[i]) > 42) velocities[i] *= -1;
        if (Math.abs(pos[i + 1]) > 32) velocities[i + 1] *= -1;
      }
      geometry.attributes.position.needsUpdate = true;

      particles.rotation.y += 0.0006;
      particles.rotation.x += 0.0002;

      renderer?.render(scene, camera);
    };

    animate();

    // 4. Resize Observer
    const handleResize = () => {
      if (!container || !renderer) return;
      const w = Math.max(container.clientWidth, 320);
      const h = Math.max(container.clientHeight, 320);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    // 5. Cleanup to prevent WebGL context leaks
    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      geometry.dispose();
      material.dispose();
      if (renderer) {
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      }
    };
  }, [particleCount]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 pointer-events-none overflow-hidden -z-10 ${className}`}
      aria-hidden="true"
    />
  );
}

export default ThreeParticleCanvas;
