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
    float sunDot = clamp(dot(normalize(uSunDirection), n), -0.2, 1.0);
    float sunGlow = pow(max(sunDot, 0.0), 1.2) * 0.7 + 0.35;
    vec3 col = uColor * rim * uIntensity * sunGlow;
    gl_FragColor = vec4(col, rim * 0.98);
  }
`;

const CLOUDS_FRAG = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform vec3 uTint;
  uniform vec3 uShadow;
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
    float a = 0.55;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) {
      v += a * vnoise(p);
      p = rot * p * 2.08;
      a *= 0.5;
    }
    return v;
  }

  vec2 swirl(vec2 p, vec2 center, float strength, float radius) {
    vec2 d = p - center;
    float dist = length(d);
    float t = smoothstep(radius, 0.0, dist) * strength;
    float c = cos(t);
    float s = sin(t);
    return center + mat2(c, -s, s, c) * d;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    vec2 uv = vec2(lon * 1.15, lat * 1.6);
    uv.x += uTime * 0.025;

    vec2 warped = uv;
    warped = swirl(warped, vec2(1.4, 0.4), 0.9, 0.5);
    warped = swirl(warped, vec2(-2.1, -0.6), -0.8, 0.55);
    warped = swirl(warped, vec2(3.2, -0.2), 0.7, 0.45);
    warped = swirl(warped, vec2(-0.6, 0.9), -0.6, 0.4);

    float band0 = fbm(warped * 1.6);
    float band1 = fbm(warped * 3.8 + 7.4);
    float band2 = fbm(uv * 8.5 - 3.1);
    float base = band0 * 0.45 + band1 * 0.4 + band2 * 0.15;

    float latitudinalBands = 0.55 + 0.4 * sin(lat * 4.5);
    float itzc = exp(-pow(lat * 2.6, 2.0)) * 0.3;
    float density = clamp(base * latitudinalBands + itzc - 0.42, 0.0, 1.0);
    density = pow(density, 1.6);

    float sunDot = clamp(dot(normalize(uSunDirection), n), 0.0, 1.0);
    float lit = 0.32 + sunDot * 1.05;
    float thickness = density * density;
    vec3 col = mix(uShadow, uTint, lit);
    col = mix(col, uTint * 1.18, thickness * sunDot);

    float alpha = density * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createAtmosphere({ THREE, scene, marsRadiusScene = 1.0 }) {
  const haloGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.06, 96, 64);
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color("#6fa8d8") },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uIntensity: { value: 1.05 },
      uPower: { value: 3.2 },
    },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 5;
  scene.add(halo);

  const cloudGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.024, 128, 80);
  const cloudMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: CLOUDS_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.72 },
      uSunDirection: haloMaterial.uniforms.uSunDirection,
      uTint: { value: new THREE.Color("#ffffff") },
      uShadow: { value: new THREE.Color("#7a8090") },
    },
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  clouds.renderOrder = 4;
  clouds.visible = true;
  scene.add(clouds);

  return {
    halo,
    clouds,
    setSunDirection(vec3) {
      haloMaterial.uniforms.uSunDirection.value.copy(vec3).normalize();
    },
    setVisualMode(mode) {
      if (mode === "mars") {
        haloMaterial.uniforms.uColor.value.set("#c8804a");
        haloMaterial.uniforms.uIntensity.value = 0.65;
        cloudMaterial.uniforms.uTint.value.set("#e0c8a8");
        cloudMaterial.uniforms.uShadow.value.set("#6a5a4a");
      } else if (mode === "atlas") {
        haloMaterial.uniforms.uColor.value.set("#a8c8e8");
        haloMaterial.uniforms.uIntensity.value = 0.85;
        cloudMaterial.uniforms.uTint.value.set("#f4f4f8");
        cloudMaterial.uniforms.uShadow.value.set("#808898");
      } else {
        haloMaterial.uniforms.uColor.value.set("#6fa8d8");
        haloMaterial.uniforms.uIntensity.value = 1.05;
        cloudMaterial.uniforms.uTint.value.set("#ffffff");
        cloudMaterial.uniforms.uShadow.value.set("#7a8090");
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
      clouds.rotation.y += dt * 0.012;
    },
  };
}
