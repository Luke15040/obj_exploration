/**
 * GLSL shared by the dots and block shaders: the speaker as a simple circular
 * pattern of holes sunk into whatever surface it sits on.
 * The hole centres come from speaker-patterns.js (uSpkHoles), same as the wireframe in extras.js.
 * Expects MAX_EXTRAS, uExtraCount, uExtraP/N/Info and
 * uSpk = (pattern radius R, hole radius, hole depth) to be declared.
 */
export const speakerHolesGLSL = /* glsl */ `
uniform vec2  uSpkHoles[32];   // hole centres, in units of the pattern radius (speaker-patterns.js)
uniform int   uSpkHoleN;
// distance to the nearest hole of one ring (n holes, radius R) in the surface plane
float holeRing(vec2 q, float R, float n, float hr) {
  if (R < 0.01) return length(q) - hr;
  float stepA = 6.2831853 / n;
  float k = floor(atan(q.y, q.x) / stepA + 0.5) * stepA;
  return length(q - R * vec2(cos(k), sin(k))) - hr;
}

/** Distance to the nearest speaker hole (short cylinders through the surface); 1e9 if none. */
float speakerHoles(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < uExtraCount; i++) {
    vec4 info = uExtraInfo[i];
    if (info.x > 0.5 || info.y < 0.01) continue; // speakers only
    vec3 P = uExtraP[i], N = uExtraN[i];
    vec3 rel = p - P;
    float axial = dot(rel, N);
    if (abs(axial) > 12.0) continue;
    vec3 a = abs(N.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    vec3 u = normalize(cross(N, a));
    vec3 v = cross(N, u);
    vec2 q = vec2(dot(rel, u), dot(rel, v));
    float s = info.y;
    float R = uSpk.x * s, hr = uSpk.y * s, depth = uSpk.z;
    if (length(q) > R + hr + 1.0) { d = min(d, length(q) - R - hr); continue; }  // outside the pattern
    float h2 = 1e9;
    for (int k = 0; k < uSpkHoleN; k++) h2 = min(h2, length(q - uSpkHoles[k] * R) - hr);
    // from 10 mm above the mount point (the soft skin can bulge a few mm in front of it) down to the hole depth
    d = min(d, max(h2, abs(axial - (10.0 - depth) * 0.5) - (depth + 10.0) * 0.5));
  }
  return d;
}
`;
