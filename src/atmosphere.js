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
  uniform vec3 uDeepColor;
  uniform vec3 uSunDirection;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 n = normalize(vWorldNormal);
    float rim = 1.0 - max(dot(viewDir, n), 0.0);
    float fall = pow(rim, uPower);
    float bloom = pow(rim, uPower * 2.4);
    float density = fall - bloom * 0.55;
    float sunDot = clamp(dot(normalize(uSunDirection), n), -0.3, 1.0);
    float sunGlow = pow(max(sunDot, 0.0), 1.5) * 0.95 + 0.22;
    vec3 col = mix(uDeepColor, uColor, smoothstep(0.0, 0.85, fall));
    col *= uIntensity * sunGlow;
    gl_FragColor = vec4(col * density, density);
  }
`;

const CLOUDS_FRAG = `
  uniform sampler2D uCloudMap;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform vec3 uTint;
  uniform vec3 uShadow;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  vec2 vortex(vec2 uv, vec2 center, float strength, float radius) {
    vec2 d = uv - center;
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
    float u = lon / (2.0 * 3.14159265) + 0.5 + uTime * 0.0035;
    float v = 0.5 - lat / 3.14159265;

    vec2 uv = vec2(u, v);
    uv = vortex(uv, vec2(0.18, 0.32), 1.6, 0.13);
    uv = vortex(uv, vec2(0.74, 0.38), -1.4, 0.14);
    uv = vortex(uv, vec2(0.42, 0.65), 1.2, 0.12);
    uv = vortex(uv, vec2(0.88, 0.7), -1.0, 0.1);
    uv = vortex(uv, vec2(0.05, 0.58), 0.9, 0.09);

    vec4 sample0 = texture2D(uCloudMap, uv);
    vec4 sample1 = texture2D(uCloudMap, vec2(uv.x * 1.7 + 0.13, uv.y * 1.3 + 0.07));
    vec4 sample2 = texture2D(uCloudMap, vec2(uv.x * 3.4 - 0.21, uv.y * 2.5 - 0.18));
    float density = sample0.r * 0.7 + sample1.r * 0.3 + sample2.r * 0.18;
    density = clamp(pow(density, 1.0) - 0.05, 0.0, 1.0);

    float sunDotRaw = dot(normalize(uSunDirection), n);
    float sunDot = clamp(sunDotRaw, 0.0, 1.0);
    float dayMix = smoothstep(-0.15, 0.18, sunDotRaw);
    float lit = 0.06 + sunDot * 1.32;
    vec3 col = mix(uShadow, uTint, lit);
    col = mix(col, uTint * 1.3, density * sunDot * 0.8);
    col *= mix(vec3(0.18, 0.22, 0.32), vec3(1.0), dayMix);

    float alpha = density * uOpacity * mix(0.3, 1.0, dayMix);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createAtmosphere({ THREE, scene, marsRadiusScene = 1.0, cloudTexture = null }) {
  const haloGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.35, 144, 96);
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color("#9ac6ee") },
      uDeepColor: { value: new THREE.Color("#0a1c38") },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uIntensity: { value: 1.4 },
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

  const cloudGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.028, 128, 80);
  const cloudMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: CLOUDS_FRAG,
    uniforms: {
      uCloudMap: { value: cloudTexture },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uSunDirection: haloMaterial.uniforms.uSunDirection,
      uTint: { value: new THREE.Color("#f8faff") },
      uShadow: { value: new THREE.Color("#506074") },
    },
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  clouds.renderOrder = 4;
  clouds.visible = !!cloudTexture;
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
