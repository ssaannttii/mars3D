export function createHeightTexture(THREE, meta, heightData) {
  const size = meta.width * meta.height;
  const data = new Float32Array(size);
  for (let i = 0; i < size; i += 1) data[i] = heightData[i];
  const texture = new THREE.DataTexture(data, meta.width, meta.height, THREE.RedFormat, THREE.FloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const WATER_VERT = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = `
  uniform sampler2D uHeight;
  uniform float uSeaLevel;
  uniform float uMinHeight;
  uniform float uMaxHeight;
  uniform vec3 uShallowColor;
  uniform vec3 uMidColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSunDirection;
  uniform vec3 uShoreColor;
  uniform float uTime;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float sampleHeight(vec2 uv) {
    return texture2D(uHeight, uv).r;
  }

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
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    vec2 uv = vec2(lon / (2.0 * 3.14159265) + 0.5, 0.5 - lat / 3.14159265);

    float h = sampleHeight(uv);
    float depth = uSeaLevel - h;
    if (depth < -25.0) discard;

    float shore = smoothstep(-25.0, 60.0, depth);
    float deepness = clamp(depth / 6500.0, 0.0, 1.0);
    vec3 baseColor = mix(uShallowColor, uMidColor, smoothstep(0.0, 0.35, deepness));
    baseColor = mix(baseColor, uDeepColor, smoothstep(0.3, 1.0, deepness));

    vec2 wave1 = uv * vec2(420.0, 220.0) + vec2(uTime * 0.18, uTime * 0.07);
    vec2 wave2 = uv * vec2(880.0, 440.0) + vec2(-uTime * 0.11, uTime * 0.16);
    float ripple = fbm(wave1) * 0.55 + fbm(wave2) * 0.45;
    vec3 ripplePerturb = normalize(vec3(
      ripple - fbm(wave1 + vec2(1.7, 0.0)),
      0.55,
      ripple - fbm(wave1 + vec2(0.0, 1.7))
    ));
    vec3 nRippled = normalize(n + ripplePerturb * 0.045);

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, nRippled), 0.0), 3.0);

    float sunDot = max(dot(normalize(uSunDirection), nRippled), 0.0);
    vec3 reflectDir = reflect(-normalize(uSunDirection), nRippled);
    float spec = pow(max(dot(reflectDir, viewDir), 0.0), 120.0) * sunDot * 2.2;
    float specWide = pow(max(dot(reflectDir, viewDir), 0.0), 24.0) * sunDot * 0.45;
    float diffuse = 0.32 + sunDot * 0.68;

    vec3 col = baseColor * diffuse;
    col = mix(col, vec3(1.05, 1.1, 1.15), fresnel * 0.42);
    col += vec3(1.0, 0.97, 0.86) * (spec + specWide);

    float foam = smoothstep(0.0, 40.0, depth) * (1.0 - smoothstep(40.0, 180.0, depth));
    foam *= 0.6 + 0.4 * fbm(uv * 900.0 + uTime * 0.3);
    col = mix(col, vec3(0.92, 0.95, 0.97), foam * 0.55);

    col = mix(uShoreColor * (0.5 + sunDot * 0.5), col, shore);

    float alpha = clamp(shore * 0.65 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createWaterMaterial(THREE, { heightTexture, meta }) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uHeight: { value: heightTexture },
      uSeaLevel: { value: 0 },
      uMinHeight: { value: meta.minimumMeters },
      uMaxHeight: { value: meta.maximumMeters },
      uShallowColor: { value: new THREE.Color("#4ea4c8") },
      uMidColor: { value: new THREE.Color("#1f5f9a") },
      uDeepColor: { value: new THREE.Color("#08234f") },
      uShoreColor: { value: new THREE.Color("#c8b89a") },
      uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
      uTime: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

export function setWaterPalette(material, mode) {
  if (mode === "mars") {
    material.uniforms.uShallowColor.value.set("#4eb4cd");
    material.uniforms.uMidColor.value.set("#1a6e9a");
    material.uniforms.uDeepColor.value.set("#06203f");
    material.uniforms.uShoreColor.value.set("#a8825c");
  } else if (mode === "atlas") {
    material.uniforms.uShallowColor.value.set("#7fcbd6");
    material.uniforms.uMidColor.value.set("#3490b4");
    material.uniforms.uDeepColor.value.set("#1c3f70");
    material.uniforms.uShoreColor.value.set("#d4c4a0");
  } else {
    material.uniforms.uShallowColor.value.set("#4ea4c8");
    material.uniforms.uMidColor.value.set("#1f5f9a");
    material.uniforms.uDeepColor.value.set("#08234f");
    material.uniforms.uShoreColor.value.set("#c8b89a");
  }
}
