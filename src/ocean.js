// Visual water only. The CPU and vertex shader deliberately use the same swells.
// Every time-dependent phase travels along -Z, toward the camera, never sideways.
export function sampleOceanHeight(x, z, time, amplitude = 1) {
  return amplitude * (
    Math.sin(z * 0.23 + time * 1.25) * 0.62 * (0.78 + 0.22 * Math.cos(x * 0.11)) +
    Math.sin(z * 0.47 + time * 2.0) * 0.2 * (0.85 + 0.15 * Math.cos(x * 0.19)) +
    Math.sin(z * 0.14 + time * 0.8) * Math.sin(x * 0.25) * 0.06
  );
}

export const OCEAN_GLSL = `
  float oceanHeight(float x, float z, float time) {
    return uAmplitude * (
      sin(z * .23 + time * 1.25) * .62 * (.78 + .22 * cos(x * .11)) +
      sin(z * .47 + time * 2.) * .2 * (.85 + .15 * cos(x * .19)) +
      sin(z * .14 + time * .8) * sin(x * .25) * .06
    );
  }
`;
