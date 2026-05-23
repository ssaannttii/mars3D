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
  uniform sampler2D uCloudMap;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform vec3 uTint;
  uniform vec3 uShadow;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vWorldNormal);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    float u = lon / (2.0 * 3.14159265) + 0.5 + uTime * 0.0035;
    float v = 0.5 - lat / 3.14159265;
    vec4 sample0 = texture2D(uCloudMap, vec2(u, v));
    vec4 sample1 = texture2D(uCloudMap, vec2(u * 1.7 + 0.13, v * 1.3 + 0.07));
    float density = sample0.r * 0.85 + sample1.r * 0.28;
    density = clamp(pow(density, 1.05), 0.0, 1.0);

    float sunDot = clamp(dot(normalize(uSunDirection), n), 0.0, 1.0);
    float lit = 0.55 + sunDot * 1.05;
    vec3 col = mix(uShadow, uTint, lit);
    col = mix(col, uTint * 1.25, density * sunDot * 0.7);

    float alpha = density * uOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createAtmosphere({ THREE, scene, marsRadiusScene = 1.0, cloudTexture = null }) {
  const haloGeometry = new THREE.SphereGeometry(marsRadiusScene * 1.075, 128, 80);
  const haloMaterial = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color("#8ec0ec") },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uIntensity: { value: 1.55 },
      uPower: { value: 2.6 },
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
