import * as THREE from 'three';

/**
 * The Earth's surface and its atmosphere, as shaders: the one place the
 * globe view decides what the planet looks like (the S2 "lifted arcs" look).
 *
 * The surface shader samples the textures from public/globe/ itself,
 * longitude and latitude worked out from the point's direction, so the
 * sphere's own texture coordinates never matter. One pass does all of it:
 *
 * - day colour, lit by the sun (the same sun the 2D map's terminator uses),
 * - city lights where it is night,
 * - the sun's glint on water only (earth-land.png),
 * - drifting clouds made from noise, so no cloud image ships,
 * - a blue haze toward the edge of the disc.
 *
 * Everything runs on the phone's graphics chip, per pixel, every frame,
 * which is cheap there: it is the same work any 3D game does for a lit,
 * textured ball.
 */

const SURFACE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPosition;
void main() {
  vNormal = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D landMap;
uniform vec3 sunDirection;
uniform float cloudTime;
varying vec3 vNormal;
varying vec3 vWorldPosition;

const float PI = 3.141592653589793;

// Equirectangular lookup that hides the seam at the 180th meridian: the
// texture's mip level comes from whichever of two wrap points changes
// least between neighbouring pixels.
vec4 sampleEarth(sampler2D map, vec3 n) {
  float lon = atan(-n.z, n.x);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  vec2 uv = vec2((lon + PI) / (2.0 * PI), (lat + 0.5 * PI) / PI);
  vec2 shifted = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dxShifted = dFdx(shifted), dyShifted = dFdy(shifted);
  if (dot(dxShifted, dxShifted) + dot(dyShifted, dyShifted) < dot(dx, dx) + dot(dy, dy)) {
    dx = dxShifted;
    dy = dyShifted;
  }
  return textureGrad(map, uv, dx, dy);
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float clouds(vec3 n) {
  vec3 p = n * 3.2 + vec3(cloudTime, 0.0, cloudTime * 0.4);
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return smoothstep(0.52, 0.78, value);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float sunlight = dot(n, sunDirection);
  // Dusk is a soft band, not a hard line.
  float day = smoothstep(-0.12, 0.22, sunlight);

  vec3 dayColour = sampleEarth(dayMap, n).rgb * (0.42 + 0.7 * max(sunlight, 0.0));
  // The night side stays readable: the land is dimmed and tinted blue, with the city lights on top.
  vec3 nightColour = sampleEarth(dayMap, n).rgb * vec3(0.16, 0.19, 0.28) + sampleEarth(nightMap, n).rgb * vec3(1.15, 0.95, 0.7);
  vec3 colour = mix(nightColour, dayColour, day);

  float water = 1.0 - sampleEarth(landMap, n).r;
  vec3 halfway = normalize(sunDirection + viewDirection);
  colour += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, halfway), 0.0), 70.0) * water * day * 0.55;

  float cover = clouds(n) * 0.75;
  vec3 cloudColour = vec3(1.0) * (0.12 + 0.88 * max(sunlight, 0.0));
  colour = mix(colour, cloudColour, cover);

  float rim = pow(1.0 - max(dot(n, viewDirection), 0.0), 3.0);
  colour = mix(colour, vec3(0.55, 0.75, 1.0) * (0.25 + 0.75 * day), rim * 0.65);

  gl_FragColor = vec4(colour, 1.0);
}
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
varying vec3 vNormal;
void main() {
  float glow = pow(max(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  gl_FragColor = vec4(0.5, 0.75, 1.0, 1.0) * glow * 2.4;
}
`;

export type EarthTextures = { day: THREE.Texture; night: THREE.Texture; land: THREE.Texture };

export function surfaceMaterial(textures: EarthTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    uniforms: {
      dayMap: { value: textures.day },
      nightMap: { value: textures.night },
      landMap: { value: textures.land },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      cloudTime: { value: 0 },
    },
  });
}

/** A glow just outside the sphere, drawn from its inside so it rings the disc. */
export function atmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
