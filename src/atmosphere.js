const ATMOSPHERE_VERT = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATMOSPHERE_FRAG = `
  uniform vec3 uColor;
  uniform vec3 uSunDirection;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 n = normalize(vWorldNormal);
    float rim = 1.0 - max(dot(viewDir, n), 0.0);
    rim = pow(rim, uPower);
    float sunDot = clamp(dot(normalize(uSunDirection), n), 0.0, 1.0);
    float sunGlow = pow(sunDot, 1.2) * 0.55 + 0.45;
    vec3 col = uColor * rim * uIntensity * sunGlow;
    gl_FragColor = vec4(col, rim * 0.95);
  }
`;

const CLOUDS_FRAG = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform vec3 uTint;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    vec2 uv = vec2(lon * 0.6 + uTime * 0.04, lat * 1.1);
    float bands = fbm(uv * 2.4) * 0.55 + fbm(uv * 6.0 + 11.0) * 0.45;
    float swirl = smoothstep(0.45, 0.82, bands);
    float polar = smoothstep(1.05, 1.45, abs(lat));
    float density = clamp(swirl * 0.9 + polar * 0.25, 0.0, 1.0);
    float sunDot = clamp(dot(normalize(uSunDirection), n), 0.0, 1.0);
    float lit = 0.35 + sunDot * 0.85;
    vec3 col = uTint * lit;
    float alpha = density * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createAtmosphere({ THREE, scene, marsRadiusScene = 1.0 }) {
  const haloGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.045, 96, 64);
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color("#a8c5e8") },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uIntensity: { value: 0.55 },
      uPower: { value: 4.2 },
    },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 5;
  scene.add(halo);

  const inner = { visible: true };

  const cloudGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.012, 96, 64);
  const cloudMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: CLOUDS_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.32 },
      uSunDirection: haloMaterial.uniforms.uSunDirection,
      uTint: { value: new THREE.Color("#f7efe2") },
    },
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  clouds.renderOrder = 4;
  clouds.visible = false;
  scene.add(clouds);

  return {
    halo,
    inner,
    clouds,
    setSunDirection(vec3) {
      haloMaterial.uniforms.uSunDirection.value.copy(vec3).normalize();
    },
    setVisualMode(mode) {
      if (mode === "mars") {
        haloMaterial.uniforms.uColor.value.set("#c8804a");
        haloMaterial.uniforms.uIntensity.value = 0.4;
        cloudMaterial.uniforms.uTint.value.set("#d9c4a8");
      } else if (mode === "atlas") {
        haloMaterial.uniforms.uColor.value.set("#b9d2ec");
        haloMaterial.uniforms.uIntensity.value = 0.5;
        cloudMaterial.uniforms.uTint.value.set("#ffffff");
      } else {
        haloMaterial.uniforms.uColor.value.set("#a8c5e8");
        haloMaterial.uniforms.uIntensity.value = 0.55;
        cloudMaterial.uniforms.uTint.value.set("#f7efe2");
      }
    },
    setVisible(show) {
      halo.visible = show;
    },
    setCloudsVisible(show) {
      clouds.visible = show;
    },
    setCloudOpacity(value) {
      cloudMaterial.uniforms.uOpacity.value = value;
    },
    tick(dt) {
      cloudMaterial.uniforms.uTime.value += dt;
      clouds.rotation.y += dt * 0.018;
    },
  };
}
