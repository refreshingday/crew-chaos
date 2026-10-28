# Stylized ocean rendering

Research and implementation: 28 October 2026. Ocean art pass by Astra.

## References and decisions

- [Catlike Coding: Waves](https://catlikecoding.com/unity/tutorials/flow/waves/) explains geometric wave displacement, matching surface normals, multiple wave components and sharper crests. Crew Chaos uses a sharpened height field with curved wave fronts and analytic slopes. It is not a full fluid simulation or an exact Gerstner implementation.
- [NVIDIA GPU Gems: Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) separates large geometric swells from fine surface detail. Here, geometry carries the visible swell shape; small shader ripples change highlights without changing gameplay forces.
- [Roystan: Toon Water Shader](https://roystan.net/articles/toon-water/) demonstrates the value of foam, distorted patterns and color contrast in cartoon water. Crew Chaos uses broken crest ribbons, darker troughs and turquoise wave faces. Shore foam is attached to each island rather than sampled from a screen depth texture.
- [Three.js ocean example](https://threejs.org/examples/webgl_shaders_ocean) provides a reference for view-dependent reflections and specular highlights. This implementation uses an inexpensive Fresnel tint and sun highlight instead of an additional reflection render pass.

## Runtime

`src/ocean.js` contains the shared CPU height sample and GLSL surface function. Both use the same wave phases, amplitudes and crest shaping. The renderer samples the height for the hull, swimming crew, floating objects and foam, and the ship pitches and rolls with the local slope. The visual sea does not apply launch forces; finite-width hazard breakers remain a separate readable game mechanic.

The ocean is one displaced mesh, roughly 36,000 vertices and one draw call. Analytic normals follow the geometric surface. There are no downloaded textures, per-frame CPU mesh updates, reflection render targets or water postprocessing passes. Reduced motion lowers swell amplitude and freezes cosmetic animation.

This is a mobile-conscious design choice, not a measured performance guarantee across phones. Physical Android/iOS frame time and battery testing remain outstanding.
