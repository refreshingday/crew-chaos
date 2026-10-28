// Cosmetic only: CPU flotation and GPU displacement share these exact phases.
// Curving wave fronts all travel toward -Z. No simulation force comes from them.
export function sampleOceanHeight(x, z, time, amplitude = 1) {
  const a = z * 0.205 + 0.95 * Math.sin(x * 0.075) + 0.22 * Math.sin(x * 0.043 + z * 0.065) + time * 1.25;
  const b = z * 0.36 - 0.6 * Math.sin(x * 0.13 + z * 0.018) + time * 1.9 + 0.7;
  const c = z * 0.62 + 0.5 * Math.sin(x * 0.21) + time * 2.6;
  const crest = Math.sin(a);
  return amplitude * (1.25 * (crest + 0.22 * (crest * crest - 0.5)) + 0.48 * Math.sin(b) + 0.18 * Math.sin(c));
}

export const OCEAN_GLSL = `
  // Height and analytic slopes; the extra harmonic concentrates the crests.
  vec3 oceanSurface(float x, float z, float time, out vec2 crests) {
    float bend = x * .043 + z * .065;
    float bendB = x * .13 + z * .018;
    float a = z * .205 + .95 * sin(x * .075) + .22 * sin(bend) + time * 1.25;
    float b = z * .36 - .6 * sin(bendB) + time * 1.9 + .7;
    float c = z * .62 + .5 * sin(x * .21) + time * 2.6;
    float s = sin(a);
    float da = 1.25 * cos(a) * (1. + .44 * s);
    float db = .48 * cos(b);
    float dc = .18 * cos(c);
    float height = 1.25 * (s + .22 * (s * s - .5)) + .48 * sin(b) + .18 * sin(c);
    float dx = da * (.07125 * cos(x * .075) + .00946 * cos(bend))
             - db * .078 * cos(bendB) + dc * .105 * cos(x * .21);
    float dz = da * (.205 + .0143 * cos(bend)) + db * (.36 - .0108 * cos(bendB)) + dc * .62;
    crests = vec2(s, sin(b));
    return vec3(height, dx, dz) * uAmplitude;
  }
`;
