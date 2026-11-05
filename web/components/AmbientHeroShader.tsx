"use client";

import React, { useEffect, useRef, useState } from "react";

export function AmbientHeroShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isWebGPUActive, setIsWebGPUActive] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number;
    let device: any = null;
    let resizeObserver: ResizeObserver | null = null;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = Math.max(1, canvas.clientWidth || 1440);
      canvas.height = Math.max(1, canvas.clientHeight || 640);
    }

    async function initWebGPU() {
      // Runtime check for WebGPU availability
      if (typeof window === "undefined" || !("gpu" in navigator)) {
        return;
      }

      try {
        const gpu = (navigator as any).gpu;
        if (!gpu) return;

        const adapter = await gpu.requestAdapter();
        if (!adapter || !isMounted) return;

        device = await adapter.requestDevice();
        if (!device || !isMounted) return;

        device.lost?.then((info: any) => {
          console.warn("AmbientHeroShader WebGPU device lost:", info);
          if (isMounted) setIsWebGPUActive(false);
        });

        if (!canvas) return;

        const context = (canvas.getContext("webgpu") as any);
        if (!context) return;

        const format = gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format,
          alphaMode: "premultiplied",
        });

        // 2D Procedural Ambient Gradient Shader (Zero 3D meshes)
        const shaderCode = `
          struct Uniforms {
            resolution: vec2f,
            time: f32,
            pad: f32,
          };

          @group(0) @binding(0) var<uniform> u: Uniforms;

          struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) uv: vec2f,
          };

          @vertex
          fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            var pos = array<vec2f, 3>(
              vec2f(-1.0, -1.0),
              vec2f(3.0, -1.0),
              vec2f(-1.0, 3.0)
            );
            var out: VertexOutput;
            out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
            out.uv = pos[vertexIndex] * 0.5 + 0.5;
            return out;
          }

          @fragment
          fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
            // Institutional deep navy base (#05070e)
            let baseNavy = vec3f(0.0196, 0.0275, 0.0549);
            // Emerald accent (#00d26a)
            let emerald = vec3f(0.0, 0.8235, 0.4157);
            // Cyan accent (#00a3ff)
            let cyan = vec3f(0.0, 0.6392, 1.0);

            let t = u.time * 0.2;

            // Subtle 2D undulating ambient fluid swells
            let swell1 = sin(uv.x * 2.5 + t) * cos(uv.y * 2.0 - t * 0.7) * 0.5 + 0.5;
            let swell2 = cos((1.0 - uv.x) * 2.8 - t * 0.6) * sin(uv.y * 2.4 + t * 0.5) * 0.5 + 0.5;
            let centerPulse = (1.0 - length(uv - vec2f(0.5, 0.35))) * 0.4;

            // Enforce subtle 6% opacity swell intensity
            let emeraldIntensity = swell1 * 0.06;
            let cyanIntensity = (swell2 * 0.8 + max(centerPulse, 0.0) * 0.2) * 0.06;

            let finalColor = baseNavy + (emerald * emeraldIntensity) + (cyan * cyanIntensity);
            return vec4f(finalColor, 1.0);
          }
        `;

        const shaderModule = device.createShaderModule({ code: shaderCode });

        // Uniform buffer: resolution (8 bytes) + time (4 bytes) + pad (4 bytes) = 16 bytes
        const uniformBuffer = device.createBuffer({
          size: 16,
          usage: 64 | 8, // GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
          },
          fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{ format }],
          },
          primitive: {
            topology: "triangle-list",
          },
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: { buffer: uniformBuffer },
            },
          ],
        });

        const resize = () => {
          if (!canvas) return;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
          const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
        };

        resize();
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(canvas);

        if (isMounted) {
          setIsWebGPUActive(true);
        }

        const startTime = performance.now();
        const uniformData = new Float32Array(4);

        const renderFrame = () => {
          if (!isMounted || !device || !canvas) return;

          // Frame-gating: Throttle execution when document is hidden to protect GPU/battery
          if (document.hidden) {
            animationFrameId = requestAnimationFrame(renderFrame);
            return;
          }

          try {
            const elapsed = (performance.now() - startTime) / 1000;
            uniformData[0] = canvas.width;
            uniformData[1] = canvas.height;
            uniformData[2] = elapsed;
            uniformData[3] = 0;

            device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer);

            const commandEncoder = device.createCommandEncoder();
            const textureView = context.getCurrentTexture().createView();

            const renderPass = commandEncoder.beginRenderPass({
              colorAttachments: [
                {
                  view: textureView,
                  clearValue: { r: 0.0196, g: 0.0275, b: 0.0549, a: 1.0 },
                  loadOp: "clear",
                  storeOp: "store",
                },
              ],
            });

            renderPass.setPipeline(pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(3);
            renderPass.end();

            device.queue.submit([commandEncoder.finish()]);

            animationFrameId = requestAnimationFrame(renderFrame);
          } catch (renderErr) {
            console.warn("AmbientHeroShader frame error:", renderErr);
            if (isMounted) setIsWebGPUActive(false);
          }
        };

        animationFrameId = requestAnimationFrame(renderFrame);
      } catch (err) {
        // Safe fallback to CSS gradient
        console.warn("AmbientHeroShader WebGPU fallback:", err);
      }
    }

    initWebGPU();

    return () => {
      isMounted = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (device && typeof device.destroy === "function") {
        device.destroy();
      }
    };
  }, []);

  return (
    <div
      className="absolute top-0 left-0 right-0 h-[640px] pointer-events-none overflow-hidden -z-10"
      style={{
        // High-fidelity instant CSS radial/mesh fallback layer for SSR, mobile, and non-WebGPU runtimes
        backgroundColor: "#05070e",
        backgroundImage: `
          radial-gradient(circle at 25% 25%, rgba(0, 210, 106, 0.06) 0%, transparent 60%),
          radial-gradient(circle at 75% 75%, rgba(0, 163, 255, 0.06) 0%, transparent 60%),
          radial-gradient(circle at 50% 30%, rgba(245, 158, 11, 0.03) 0%, transparent 50%)
        `,
        maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
      }}
    >
      <canvas
        ref={canvasRef}
        className={`w-full h-full pointer-events-none transition-opacity duration-1000 ${
          isWebGPUActive ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

export default AmbientHeroShader;
