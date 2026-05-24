import { ShaderPass } from "../vendor/postprocessing/ShaderPass.js";

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec3 uCameraPos;
  uniform mat4 uInvProj;
  uniform mat4 uInvView;
  uniform float uPlanetRadius;
  uniform float uAtmoRadius;
  uniform vec3 uSunDirection;
  uniform vec3 uAtmoColor;
  uniform vec3 uHorizonColor;
  uniform float uIntensity;
  varying vec2 vUv;

  vec2 raySphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(-1.0, -1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  void main() {
    vec4 sceneCol = texture2D(tDiffuse, vUv);

    vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 viewPos = uInvProj * ndc;
    viewPos /= viewPos.w;
    vec3 worldDir = normalize((uInvView * vec4(viewPos.xyz, 0.0)).xyz);

    vec3 ro = uCameraPos;
    vec3 rd = worldDir;

    vec2 hitAtmo = raySphere(ro, rd, uAtmoRadius);
    if (hitAtmo.y < 0.0) {
      gl_FragColor = sceneCol;
      return;
    }

    float tEnter = max(hitAtmo.x, 0.0);
    float tExit = hitAtmo.y;

    // If the ray hits the planet, clip atmosphere segment at planet entry
    vec2 hitPlanet = raySphere(ro, rd, uPlanetRadius);
    bool hitsPlanet = hitPlanet.x > 0.0 && hitPlanet.x < tExit;
    if (hitsPlanet) tExit = hitPlanet.x;

    float through = max(tExit - tEnter, 0.0);
    if (through <= 0.0) {
      gl_FragColor = sceneCol;
      return;
    }

    float chordMax = 2.0 * sqrt(uAtmoRadius * uAtmoRadius - uPlanetRadius * uPlanetRadius);
    float density = clamp(through / chordMax, 0.0, 1.0);
    float scatter = 1.0 - exp(-density * 3.2);

    vec3 midPoint = ro + rd * ((tEnter + tExit) * 0.5);
    vec3 midNormal = normalize(midPoint);
    float sunDot = clamp(dot(normalize(uSunDirection), midNormal), -0.3, 1.0);
    float sunGlow = pow(max(sunDot, 0.0), 1.4) * 0.95 + 0.16;

    vec3 atmoCol = mix(uHorizonColor, uAtmoColor, scatter);
    atmoCol *= sunGlow;

    // When the ray hits the planet, atmosphere overlays the surface (haze)
    // When it doesn't, the atmosphere is the dominant glow against space
    if (hitsPlanet) {
      // Less haze in center (where chord through atmo near planet is small relative to direct surface dist)
      float centerFade = smoothstep(0.0, 1.0, scatter);
      float haze = centerFade * uIntensity * 0.32;
      vec3 finalCol = sceneCol.rgb * (1.0 - haze * 0.25) + atmoCol * haze;
      gl_FragColor = vec4(finalCol, 1.0);
    } else {
      float glow = scatter * uIntensity;
      vec3 finalCol = sceneCol.rgb + atmoCol * glow;
      gl_FragColor = vec4(finalCol, 1.0);
    }
  }
`;

export function createAtmospherePass(THREE, camera, options = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uCameraPos: { value: new THREE.Vector3() },
      uInvProj: { value: new THREE.Matrix4() },
      uInvView: { value: new THREE.Matrix4() },
      uPlanetRadius: { value: options.planetRadius ?? 1.0 },
      uAtmoRadius: { value: options.atmoRadius ?? 1.2 },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uAtmoColor: { value: new THREE.Color(options.color ?? "#7eb2e6") },
      uHorizonColor: { value: new THREE.Color(options.horizon ?? "#244d8a") },
      uIntensity: { value: options.intensity ?? 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  pass.needsSwap = true;
  pass.update = () => {
    pass.uniforms.uCameraPos.value.copy(camera.position);
    pass.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    pass.uniforms.uInvView.value.copy(camera.matrixWorld);
  };
  return pass;
}
