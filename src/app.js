import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { CAMERA_TARGETS, focusCamera, resetCamera } from "./camera.js";
import { createColorTools } from "./colors.js";
import { FloodModel } from "./flood.js";
import { RESOLUTIONS, buildTerrainGeometry, updateTerrainColors } from "./geometry.js";
import { buildRiverLines, simulateRivers } from "./rivers.js";
import { loadTopography, sampleFloodMask, sampleHeight, sphericalPoint } from "./topography.js";
import { createAtmosphere } from "./atmosphere.js";
import { applyToDom, getLang, localeForNumbers, onLangChange, setLang, t } from "./i18n.js";
import { createHeightTexture, createWaterMaterial, setWaterPalette } from "./water-shader.js";

const LAKE_THRESHOLD_KM2 = 80000;

const PLACES = [
  { name: "Olympus Mons", lat: 18.65, lon: 226.2 },
  { name: "Valles Marineris", lat: -14.0, lon: 300.0 },
  { name: "Hellas Planitia", lat: -42.4, lon: 70.5 },
  { name: "Argyre Planitia", lat: -49.7, lon: 316.0 },
  { name: "Gale Crater", lat: -5.4, lon: 137.8 },
  { name: "Jezero Crater", lat: 18.44, lon: 77.45 },
  { name: "Elysium Mons", lat: 25.0, lon: 147.0 },
];

const state = {
  seaLevel: 0,
  verticalScale: 3,
  resolution: "ultra",
  visualMode: "earth",
  biomes: true,
  ultraCreative: false,
  ultraIntensity: "cinematic",
  waterVisible: true,
  riversVisible: true,
  tributariesVisible: true,
  connectedFlood: true,
  softShore: true,
  snowCaps: true,
  polarIce: true,
  orientationVisible: true,
  labelsVisible: true,
  wireframe: false,
  autoRotate: true,
  atmosphere: true,
  clouds: true,
  iceExtent: 0.35,
};

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x08090d, 0.035);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0.35, 0.28, 3.25);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.42;
controls.zoomSpeed = 0.75;
controls.minDistance = 1.45;
controls.maxDistance = 7.5;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.25;

scene.add(new THREE.HemisphereLight(0xc8f7ff, 0x1a0e08, 0.55));
const sun = new THREE.DirectionalLight(0xfff3da, 5.8);
sun.position.set(4.2, 1.4, 2.6);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x4a5566, 0.25));

const textureLoader = new THREE.TextureLoader();
const cloudTexture = textureLoader.load("./data/clouds.jpg");
cloudTexture.wrapS = THREE.RepeatWrapping;
cloudTexture.colorSpace = THREE.SRGBColorSpace;
cloudTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

const normalTexture = textureLoader.load("./data/mars-mola-normal-1440x720.png");
normalTexture.wrapS = THREE.RepeatWrapping;
normalTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

const marsAlbedoTexture = textureLoader.load("./data/mars_albedo.jpg");
marsAlbedoTexture.wrapS = THREE.RepeatWrapping;
marsAlbedoTexture.colorSpace = THREE.SRGBColorSpace;
marsAlbedoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

const detailTexture = textureLoader.load("./data/mars_albedo.jpg", (tex) => {
  const img = tex.image;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const lum = data.data[i] * 0.3 + data.data[i + 1] * 0.59 + data.data[i + 2] * 0.11;
    const v = 165 + (lum - 165) * 0.55;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.max(0, Math.min(255, v));
  }
  ctx.putImageData(data, 0, 0);
  detailTexture.image = canvas;
  detailTexture.needsUpdate = true;
});
detailTexture.wrapS = THREE.RepeatWrapping;
detailTexture.colorSpace = THREE.SRGBColorSpace;
detailTexture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;

const starsTexture = textureLoader.load("./data/stars_milky_way.jpg", (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
});

const atmosphere = createAtmosphere({ THREE, scene, cloudTexture });
atmosphere.setSunDirection(sun.position);

const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x0a0c11);
const envSun = new THREE.Mesh(
  new THREE.SphereGeometry(2.5, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff0d4 }),
);
envSun.position.set(8, 5, 3).normalize().multiplyScalar(15);
envScene.add(envSun);
const envHaze = new THREE.Mesh(
  new THREE.SphereGeometry(40, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x231a16, side: THREE.BackSide }),
);
envScene.add(envHaze);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTarget = pmrem.fromScene(envScene, 0.04);
scene.environment = envTarget.texture;

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.95,
  metalness: 0.0,
  envMapIntensity: 0.12,
  flatShading: false,
  normalMap: normalTexture,
  normalScale: new THREE.Vector2(1.1, 1.1),
  map: detailTexture,
});

const terrainUniforms = {
  uCloudMap: { value: cloudTexture },
  uSunDirection: { value: new THREE.Vector3(3.8, 2.6, 2.2).normalize() },
  uCloudShadow: { value: 0.42 },
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
};
terrainMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uCloudMap = terrainUniforms.uCloudMap;
  shader.uniforms.uSunDirection = terrainUniforms.uSunDirection;
  shader.uniforms.uCloudShadow = terrainUniforms.uCloudShadow;
  shader.uniforms.uCloudOffset = terrainUniforms.uCloudOffset;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
       varying vec3 vTerrainNormalW;`,
    )
    .replace(
      "#include <fog_vertex>",
      `#include <fog_vertex>
       vTerrainNormalW = normalize(mat3(modelMatrix) * normal);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
       uniform sampler2D uCloudMap;
       uniform vec3 uSunDirection;
       uniform float uCloudShadow;
       uniform vec2 uCloudOffset;
       varying vec3 vTerrainNormalW;`,
    )
    .replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
       vec3 nW = normalize(vTerrainNormalW);
       vec3 sunDir = normalize(uSunDirection);
       float sunDot = clamp(dot(nW, sunDir), 0.0, 1.0);
       vec3 sample_pos = nW + sunDir * 0.08;
       sample_pos = normalize(sample_pos);
       float lat = asin(clamp(sample_pos.y, -1.0, 1.0));
       float lon = atan(sample_pos.z, sample_pos.x);
       vec2 cuv = vec2(lon / (2.0 * 3.14159265) + 0.5 + uCloudOffset.x, 0.5 - lat / 3.14159265);
       float cloud = texture2D(uCloudMap, cuv).r;
       cloud = clamp(cloud - 0.05, 0.0, 1.0);
       float shadow = 1.0 - cloud * uCloudShadow * sunDot;
       gl_FragColor.rgb *= shadow;`,
    );
};

let waterMaterial = null;

const el = {
  loadState: document.querySelector("#load-state"),
  seaLevel: document.querySelector("#sea-level"),
  seaNumber: document.querySelector("#sea-number"),
  seaOutput: document.querySelector("#sea-output"),
  heightScale: document.querySelector("#height-scale"),
  scaleOutput: document.querySelector("#scale-output"),
  realScale: document.querySelector("#real-scale"),
  visibleScale: document.querySelector("#visible-scale"),
  resolutionOutput: document.querySelector("#resolution-output"),
  visualOutput: document.querySelector("#visual-output"),
  ultraOutput: document.querySelector("#ultra-output"),
  scaleOutput2: document.querySelector("#scale-output-2"),
  floodedOutput: document.querySelector("#flooded-output"),
  waterOutput: document.querySelector("#water-output"),
  riverOutput: document.querySelector("#river-output"),
  cursorOutput: document.querySelector("#cursor-output"),
  minimap: document.querySelector("#minimap"),
  balanceWater: document.querySelector("#balance-water"),
  waterToggle: document.querySelector("#water-toggle"),
  riversToggle: document.querySelector("#rivers-toggle"),
  tributariesToggle: document.querySelector("#tributaries-toggle"),
  connectedToggle: document.querySelector("#connected-toggle"),
  shoreToggle: document.querySelector("#shore-toggle"),
  snowToggle: document.querySelector("#snow-toggle"),
  polarToggle: document.querySelector("#polar-toggle"),
  biomeToggle: document.querySelector("#biome-toggle"),
  ultraToggle: document.querySelector("#ultra-toggle"),
  orientationToggle: document.querySelector("#orientation-toggle"),
  labelsToggle: document.querySelector("#labels-toggle"),
  wireToggle: document.querySelector("#wire-toggle"),
  autorotateToggle: document.querySelector("#autorotate-toggle"),
  resetCamera: document.querySelector("#reset-camera"),
  beautyShot: document.querySelector("#beauty-shot"),
  atmosphereToggle: document.querySelector("#atmosphere-toggle"),
  cloudsToggle: document.querySelector("#clouds-toggle"),
  timelapseButton: document.querySelector("#timelapse-button"),
  shareButton: document.querySelector("#share-button"),
  iceExtent: document.querySelector("#ice-extent"),
  iceOutput: document.querySelector("#ice-output"),
  seaPresetButtons: document.querySelectorAll("[data-sea-preset]"),
  resolutionButtons: document.querySelectorAll("[data-resolution]"),
  visualButtons: document.querySelectorAll("[data-visual-mode]"),
  ultraButtons: document.querySelectorAll("[data-ultra-intensity]"),
  cameraButtons: document.querySelectorAll("[data-camera-target]"),
  tourButtons: document.querySelectorAll("[data-tour]"),
};

const labelGroup = new THREE.Group();
scene.add(labelGroup);
const orientationGroup = new THREE.Group();
scene.add(orientationGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const colorTools = createColorTools(THREE);

let meta;
let heightData;
let poleHeights;
let floodModel;
let flood;
let terrainMesh;
let waterMesh;
let riverLines;
let riverModel = { rivers: [], lakes: [], deltas: [], stats: { count: 0, longestKm: 0, widestKm: 0, outletCount: 0, lakeCount: 0 } };
let stars;
let floodToken = 0;
let mapMarker = { latitude: 0, longitude: 0 };
let minimapBase;

applyToDom();
wireLangAndPanel();

init();

function wireLangAndPanel() {
  const langSel = document.querySelector("#lang-select");
  if (langSel) {
    langSel.value = getLang();
    langSel.addEventListener("change", (e) => setLang(e.target.value));
  }
  const minBtn = document.querySelector("#panel-toggle");
  const panel = document.querySelector("#controls-panel");
  const STORAGE = "mars3d.panel";
  const stored = localStorage.getItem(STORAGE);
  const setMinimized = (mini) => {
    panel.classList.toggle("minimized", mini);
    minBtn.textContent = mini ? "»" : "«";
    minBtn.title = mini ? t("ui.expand") : t("ui.minimize");
    minBtn.setAttribute("aria-label", minBtn.title);
    localStorage.setItem(STORAGE, mini ? "1" : "0");
  };
  if (minBtn && panel) {
    setMinimized(stored === "1");
    minBtn.addEventListener("click", () => setMinimized(!panel.classList.contains("minimized")));
  }
  onLangChange(() => {
    updateAllReadouts();
    if (panel) setMinimized(panel.classList.contains("minimized"));
    drawMinimap();
  });
}

async function init() {
  try {
    const topography = await loadTopography();
    meta = topography.meta;
    heightData = topography.heightData;
    poleHeights = { north: topography.northPoleHeight, south: topography.southPoleHeight };
    floodModel = new FloodModel(meta, heightData);

    const heightTexture = createHeightTexture(THREE, meta, heightData);
    waterMaterial = createWaterMaterial(THREE, { heightTexture, meta });
    waterMaterial.uniforms.uSunDirection.value.copy(sun.position).normalize();

    addStars();
    wireEvents();
    applyShareState();
    await refreshFlood({ rebuildTerrain: true });
    buildLabels();
    buildOrientation();
    updateLabels();

    el.loadState.textContent = t("status.ready");
    animate();
  } catch (error) {
    console.error(error);
    el.loadState.textContent = t("status.error");
    el.cursorOutput.textContent = t("status.molaFailed");
  }
}

async function refreshFlood({ rebuildTerrain = false } = {}) {
  const token = ++floodToken;
  el.loadState.textContent = t("status.calculating");
  const nextFlood = await floodModel.calculate({
    seaLevel: state.seaLevel,
    connected: state.connectedFlood,
    lakeThresholdKm2: LAKE_THRESHOLD_KM2,
  });
  if (token !== floodToken) return;

  flood = nextFlood;
  if (!terrainMesh || rebuildTerrain) rebuildTerrainMesh();
  else updateTerrainColors({ geometry: terrainMesh.geometry, meta, flood, state, colorTools });
  rebuildWaterMesh();
  rebuildRivers();
  drawMinimap();
  updateAllReadouts();
  el.loadState.textContent = t("status.ready");
}

function rebuildTerrainMesh() {
  const geometry = buildTerrainGeometry({
    THREE,
    meta,
    heightData,
    flood,
    state,
    colorTools,
    poleHeights,
  });

  if (terrainMesh) {
    terrainMesh.geometry.dispose();
    terrainMesh.geometry = geometry;
  } else {
    terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    terrainMesh.renderOrder = 2;
    scene.add(terrainMesh);
  }
  terrainMaterial.wireframe = state.wireframe;
  el.resolutionOutput.textContent = `${RESOLUTIONS[state.resolution].lon} x ${RESOLUTIONS[state.resolution].lat}`;
}

function rebuildWaterMesh() {
  if (!waterMaterial) return;
  waterMaterial.uniforms.uSeaLevel.value = state.seaLevel;
  setWaterPalette(waterMaterial, state.visualMode);
  const radius = 1 + ((state.seaLevel + 60) / meta.marsRadiusMeters) * state.verticalScale;
  if (!waterMesh) {
    const geometry = new THREE.SphereGeometry(1, 256, 128);
    waterMesh = new THREE.Mesh(geometry, waterMaterial);
    waterMesh.renderOrder = 3;
    scene.add(waterMesh);
  }
  waterMesh.scale.setScalar(radius);
  waterMesh.visible = state.waterVisible;
}

function rebuildRivers() {
  riverModel = simulateRivers({ meta, heightData, flood, state });
  const sampler = (lat, lon) => sampleHeight(meta, heightData, lat, lon);

  const lineGeometry = buildRiverLines({
    THREE,
    meta,
    rivers: riverModel.rivers,
    state,
    colorTools,
    heightSampler: sampler,
  });
  if (riverLines) {
    riverLines.geometry.dispose();
    riverLines.geometry = lineGeometry;
  } else {
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      linewidth: 1,
      depthWrite: false,
      depthTest: true,
    });
    riverLines = new THREE.LineSegments(lineGeometry, lineMaterial);
    riverLines.renderOrder = 4.2;
    scene.add(riverLines);
  }
  riverLines.visible = state.riversVisible && lineGeometry.getAttribute("position").count > 0;
}

function updateAllReadouts() {
  el.seaOutput.textContent = formatMeters(state.seaLevel);
  el.seaLevel.value = String(state.seaLevel);
  el.seaNumber.value = String(state.seaLevel);
  el.scaleOutput.textContent = `${state.verticalScale}x`;
  el.heightScale.value = String(state.verticalScale);
  if (state.visualMode === "earth") el.visualOutput.textContent = "Earth-like";
  else if (state.visualMode === "atlas") el.visualOutput.textContent = "Atlas";
  else el.visualOutput.textContent = "Mars raw";
  el.ultraOutput.textContent = ultraLabel(state.ultraIntensity);
  el.floodedOutput.textContent = `${flood.stats.floodedPercent.toFixed(1)}%`;
  el.waterOutput.textContent = formatWaterStats(flood.stats);
  el.riverOutput.textContent = formatRiverStats(riverModel.stats);
  el.scaleOutput2.textContent = `${t("label.radius")} ${Math.round(meta.marsRadiusMeters / 1000)} km`;
  el.polarToggle.disabled = !state.snowCaps;
}

function formatWaterStats(stats) {
  if (stats.floodedAreaKm2 < 1) return t("stat.dry");
  const ocean = formatArea(stats.oceanAreaKm2);
  if (!state.connectedFlood) return `${ocean} ${t("stat.allBelow")}`;
  if (stats.lakeCount === 0) return `${ocean} ${t("stat.ocean")}`;
  return `${ocean} ${t("stat.ocean")} / ${stats.lakeCount} ${t("stat.lakes")}`;
}

function formatArea(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M km2`;
  return `${Math.round(value / 1000)}k km2`;
}

function formatRiverStats(stats) {
  if (!stats.count) return t("stat.noRivers");
  const lakes = stats.lakeCount ? ` / ${stats.lakeCount} ${t("stat.lakes")}` : "";
  return `${stats.count} ${t("stat.rivers").toLowerCase()} / ${Math.round(stats.longestKm).toLocaleString(localeForNumbers())} km${lakes}`;
}

function setSeaLevel(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return;
  state.seaLevel = Math.min(22000, Math.max(-9000, Math.round(numericValue / 100) * 100));
  void refreshFlood();
}

async function setBalancedSeaLevel() {
  el.loadState.textContent = t("status.searching50");
  let low = meta.minimumMeters;
  let high = meta.maximumMeters;
  let bestLevel = 0;
  let bestDelta = Infinity;

  for (let i = 0; i < 14; i += 1) {
    const mid = Math.round(((low + high) / 2) / 100) * 100;
    const result = await floodModel.calculate({
      seaLevel: mid,
      connected: state.connectedFlood,
      lakeThresholdKm2: LAKE_THRESHOLD_KM2,
    });
    const delta = Math.abs(result.stats.floodedPercent - 50);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestLevel = mid;
    }
    if (result.stats.floodedPercent < 50) low = mid + 100;
    else high = mid - 100;
  }

  setSeaLevel(bestLevel);
}

function setVerticalScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return;
  state.verticalScale = Math.min(40, Math.max(1, Math.round(numericValue)));
  rebuildTerrainMesh();
  rebuildWaterMesh();
  rebuildRivers();
  updateLabels();
  buildOrientation();
  updateAllReadouts();
}

function updateVisuals({ rebuildWater = false } = {}) {
  if (!terrainMesh) return;
  updateTerrainColors({ geometry: terrainMesh.geometry, meta, flood, state, colorTools });
  if (rebuildWater) rebuildWaterMesh();
  if (state.riversVisible) rebuildRivers();
  drawMinimap();
  updateAllReadouts();
}

function wireEvents() {
  el.seaLevel.addEventListener("input", (event) => setSeaLevel(event.target.value));
  el.seaNumber.addEventListener("input", (event) => setSeaLevel(event.target.value));
  el.seaNumber.addEventListener("change", (event) => setSeaLevel(event.target.value));
  el.seaPresetButtons.forEach((button) => button.addEventListener("click", () => setSeaLevel(button.dataset.seaPreset)));
  el.balanceWater.addEventListener("click", () => void setBalancedSeaLevel());
  el.heightScale.addEventListener("input", (event) => setVerticalScale(event.target.value));
  el.realScale.addEventListener("click", () => setVerticalScale(1));
  el.visibleScale.addEventListener("click", () => setVerticalScale(3));
  const dramatic = document.querySelector("#dramatic-scale");
  if (dramatic) dramatic.addEventListener("click", () => setVerticalScale(18));

  el.waterToggle.addEventListener("change", (event) => {
    state.waterVisible = event.target.checked;
    if (waterMesh) waterMesh.visible = state.waterVisible && waterMesh.geometry.getIndex().count > 0;
  });

  el.riversToggle.addEventListener("change", (event) => {
    state.riversVisible = event.target.checked;
    rebuildRivers();
    updateAllReadouts();
  });

  el.tributariesToggle.addEventListener("change", (event) => {
    state.tributariesVisible = event.target.checked;
    rebuildRivers();
    updateAllReadouts();
  });

  el.connectedToggle.addEventListener("change", (event) => {
    state.connectedFlood = event.target.checked;
    void refreshFlood();
  });

  el.shoreToggle.addEventListener("change", (event) => {
    state.softShore = event.target.checked;
    updateVisuals({ rebuildWater: false });
  });

  el.snowToggle.addEventListener("change", (event) => {
    state.snowCaps = event.target.checked;
    updateVisuals({ rebuildWater: false });
  });

  el.polarToggle.addEventListener("change", (event) => {
    state.polarIce = event.target.checked;
    updateVisuals({ rebuildWater: false });
  });

  el.biomeToggle.addEventListener("change", (event) => {
    state.biomes = event.target.checked;
    updateVisuals({ rebuildWater: false });
  });

  el.ultraToggle.addEventListener("change", (event) => {
    state.ultraCreative = event.target.checked;
    rebuildTerrainMesh();
    rebuildWaterMesh();
    rebuildRivers();
    updateLabels();
    updateAllReadouts();
  });

  el.ultraButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.ultraIntensity = button.dataset.ultraIntensity;
      el.ultraButtons.forEach((item) => item.classList.toggle("active", item === button));
      if (state.ultraCreative) {
        rebuildTerrainMesh();
        rebuildWaterMesh();
        rebuildRivers();
        updateLabels();
      } else {
        updateVisuals({ rebuildWater: false });
      }
      updateAllReadouts();
    });
  });

  el.labelsToggle.addEventListener("change", (event) => {
    state.labelsVisible = event.target.checked;
    labelGroup.visible = state.labelsVisible;
  });

  el.orientationToggle.addEventListener("change", (event) => {
    state.orientationVisible = event.target.checked;
    orientationGroup.visible = state.orientationVisible;
  });

  el.wireToggle.addEventListener("change", (event) => {
    state.wireframe = event.target.checked;
    terrainMaterial.wireframe = state.wireframe;
  });

  el.autorotateToggle.addEventListener("change", (event) => {
    state.autoRotate = event.target.checked;
    controls.autoRotate = state.autoRotate;
  });

  el.resetCamera.addEventListener("click", () => resetCamera(camera, controls));

  el.resolutionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.resolution = button.dataset.resolution;
      el.resolutionButtons.forEach((item) => item.classList.toggle("active", item === button));
      rebuildTerrainMesh();
      rebuildWaterMesh();
      rebuildRivers();
      updateAllReadouts();
    });
  });

  el.visualButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.visualMode = button.dataset.visualMode;
      el.visualButtons.forEach((item) => item.classList.toggle("active", item === button));
      atmosphere.setVisualMode(state.visualMode);
      updateVisuals({ rebuildWater: true });
    });
  });

  if (el.atmosphereToggle) {
    el.atmosphereToggle.addEventListener("change", (event) => {
      state.atmosphere = event.target.checked;
      atmosphere.setVisible(state.atmosphere);
    });
  }

  if (el.cloudsToggle) {
    el.cloudsToggle.addEventListener("change", (event) => {
      state.clouds = event.target.checked;
      atmosphere.setCloudsVisible(state.clouds);
    });
  }

  el.cameraButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = CAMERA_TARGETS[button.dataset.cameraTarget];
      if (target) focusCamera({ THREE, camera, controls, meta, target });
    });
  });

  el.tourButtons.forEach((button) => {
    button.addEventListener("click", () => runTour(button.dataset.tour));
  });

  el.beautyShot.addEventListener("click", () => beautyShot());
  if (el.timelapseButton) el.timelapseButton.addEventListener("click", () => runSeaTimelapse());
  if (el.shareButton) el.shareButton.addEventListener("click", () => copyShareLink());
  if (el.iceExtent) {
    el.iceExtent.addEventListener("input", (event) => {
      state.iceExtent = Number(event.target.value) / 100;
      if (el.iceOutput) el.iceOutput.textContent = `${Math.round(state.iceExtent * 100)}%`;
      updateVisuals({ rebuildWater: false });
    });
  }
  el.minimap.addEventListener("click", onMinimapClick);

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", () => {
    el.cursorOutput.textContent = t("stat.cursorHint");
  });
  window.addEventListener("resize", onResize);
}

function ultraLabel(value) {
  if (value === "subtle") return t("btn.ultraSubtle");
  if (value === "extreme") return t("btn.ultraExtreme");
  return t("btn.ultraCinematic");
}

function buildLabels() {
  labelGroup.clear();
  for (const place of PLACES) {
    const sprite = makeLabelSprite(place.name);
    sprite.userData.place = place;
    labelGroup.add(sprite);
  }
}

function updateLabels() {
  labelGroup.visible = state.labelsVisible;
  for (const sprite of labelGroup.children) {
    const { lat, lon } = sprite.userData.place;
    const height = sampleHeight(meta, heightData, lat, lon);
    const position = sphericalPoint(THREE, meta, lat, lon, height + 9500, state.verticalScale);
    sprite.position.copy(position);
  }
}

function updateLabelVisibility() {
  if (!state.labelsVisible) return;
  const cameraNormal = camera.position.clone().normalize();
  for (const sprite of labelGroup.children) {
    const front = sprite.position.clone().normalize().dot(cameraNormal) > -0.08;
    sprite.visible = front;
    if (sprite.userData.place) {
      const distance = camera.position.distanceTo(sprite.position);
      const width = Math.min(0.28, Math.max(0.08, distance * 0.11));
      sprite.scale.set(width, width * 0.25, 1);
    }
  }
}

function buildOrientation() {
  orientationGroup.clear();
  orientationGroup.visible = state.orientationVisible;
  orientationGroup.add(makeLatLine(0, 0x8dd7dd, 0.7));
  orientationGroup.add(makeMeridianLine(0, 0xffffff, 0.34));
  orientationGroup.add(makeMeridianLine(180, 0xffffff, 0.22));

  const north = makeLabelSprite("N");
  north.scale.set(0.12, 0.05, 1);
  north.position.copy(sphericalPoint(THREE, meta, 90, 0, 90000, state.verticalScale));
  orientationGroup.add(north);

  const south = makeLabelSprite("S");
  south.scale.set(0.12, 0.05, 1);
  south.position.copy(sphericalPoint(THREE, meta, -90, 0, 90000, state.verticalScale));
  orientationGroup.add(south);
}

function makeLatLine(latitude, color, opacity) {
  const points = [];
  for (let i = 0; i <= 240; i += 1) {
    points.push(sphericalPoint(THREE, meta, latitude, (i / 240) * 360, 50000, state.verticalScale));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function makeMeridianLine(longitude, color, opacity) {
  const points = [];
  for (let i = 0; i <= 180; i += 1) {
    points.push(sphericalPoint(THREE, meta, 90 - i, longitude, 52000, state.verticalScale));
  }
  for (let i = 0; i <= 180; i += 1) {
    points.push(sphericalPoint(THREE, meta, -90 + i, longitude + 180, 52000, state.verticalScale));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function drawMinimap() {
  if (!flood || !el.minimap) return;
  const ctx = el.minimap.getContext("2d");
  const { width, height } = el.minimap;
  const image = ctx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const latitude = 90 - (y / (height - 1)) * 180;
    for (let x = 0; x < width; x += 1) {
      const longitude = (x / width) * 360;
      const h = sampleHeight(meta, heightData, latitude, longitude);
      const flooded = sampleFloodMask(meta, flood.mask, latitude, longitude);
      const color = colorTools.terrainColor({
        height: h,
        latitude,
        slope: 0.25,
        flooded,
        seaLevel: state.seaLevel,
        minimumMeters: meta.minimumMeters,
        maximumMeters: meta.maximumMeters,
        visualMode: state.visualMode,
        softShore: state.softShore,
        snowCaps: state.snowCaps,
        polarIce: state.polarIce,
        biomes: state.biomes,
        ultraCreative: state.ultraCreative,
        ultraIntensity: state.ultraIntensity,
        procedural: 0,
        iceExtent: state.iceExtent,
      });
      const offset = (y * width + x) * 4;
      image.data[offset] = Math.round(color.r * 255);
      image.data[offset + 1] = Math.round(color.g * 255);
      image.data[offset + 2] = Math.round(color.b * 255);
      image.data[offset + 3] = 255;
    }
  }

  minimapBase = image;
  drawMinimapMarker();
}

function drawMinimapMarker() {
  if (!minimapBase) return;
  const ctx = el.minimap.getContext("2d");
  ctx.putImageData(minimapBase, 0, 0);
  drawMinimapRivers(ctx);
  const x = (mapMarker.longitude / 360) * el.minimap.width;
  const y = ((90 - mapMarker.latitude) / 180) * el.minimap.height;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x + 8, y);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x, y + 8);
  ctx.stroke();
}

function drawMinimapRivers(ctx) {
  if (!state.riversVisible || !riverModel.rivers.length) return;
  ctx.save();
  ctx.strokeStyle = state.visualMode === "mars" ? "rgba(78, 193, 209, 0.7)" : "rgba(44, 154, 187, 0.72)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const river of riverModel.rivers.slice(0, 80)) {
    ctx.lineWidth = Math.max(0.6, Math.min(2.4, Math.sqrt(river.maxDischarge) * 0.18));
    ctx.beginPath();
    let started = false;
    let lastX = 0;
    for (const point of river.points) {
      const x = (point.lon / 360) * el.minimap.width;
      const y = ((90 - point.lat) / 180) * el.minimap.height;
      if (!started || Math.abs(x - lastX) > el.minimap.width * 0.5) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }
    ctx.stroke();
  }
  ctx.restore();
}

function onMinimapClick(event) {
  const rect = el.minimap.getBoundingClientRect();
  const longitude = ((event.clientX - rect.left) / rect.width) * 360;
  const latitude = 90 - ((event.clientY - rect.top) / rect.height) * 180;
  mapMarker = { latitude, longitude };
  drawMinimapMarker();
  const height = sampleHeight(meta, heightData, latitude, longitude);
  const surface = sampleFloodMask(meta, flood.mask, latitude, longitude) ? t("land.surface.water") : t("land.surface.dry");
  el.cursorOutput.textContent = `${latitude.toFixed(2)} deg, ${longitude.toFixed(2)} deg / ${formatMeters(height)} / ${surface}`;
  focusCamera({ THREE, camera, controls, meta, target: { lat: latitude, lon: longitude, distance: 2.18 } });
}

function runTour(name) {
  const tour = {
    seas: { sea: 3000, target: CAMERA_TARGETS.hellas },
    volcanoes: { sea: 0, target: CAMERA_TARGETS.olympus, ultra: true },
    canyons: { sea: 0, target: CAMERA_TARGETS.valles, ultra: true },
    continents: { sea: 0, target: CAMERA_TARGETS.tharsis },
  }[name];
  if (!tour) return;
  if (tour.ultra) {
    state.ultraCreative = true;
    el.ultraToggle.checked = true;
    state.ultraIntensity = "cinematic";
    el.ultraButtons.forEach((button) => button.classList.toggle("active", button.dataset.ultraIntensity === "cinematic"));
    rebuildTerrainMesh();
    rebuildWaterMesh();
    rebuildRivers();
    updateLabels();
  }
  focusCamera({ THREE, camera, controls, meta, target: tour.target });
  setSeaLevel(tour.sea);
}

function beautyShot() {
  state.visualMode = "earth";
  state.ultraCreative = true;
  state.ultraIntensity = "cinematic";
  state.snowCaps = true;
  state.polarIce = true;
  state.biomes = true;
  state.autoRotate = false;
  controls.autoRotate = false;
  el.autorotateToggle.checked = false;
  el.ultraToggle.checked = true;
  el.snowToggle.checked = true;
  el.polarToggle.checked = true;
  el.biomeToggle.checked = true;
  el.visualButtons.forEach((button) => button.classList.toggle("active", button.dataset.visualMode === "earth"));
  el.ultraButtons.forEach((button) => button.classList.toggle("active", button.dataset.ultraIntensity === "cinematic"));
  focusCamera({ THREE, camera, controls, meta, target: CAMERA_TARGETS.valles });
  setSeaLevel(0);
  rebuildTerrainMesh();
  rebuildWaterMesh();
  rebuildRivers();
  updateLabels();
  updateAllReadouts();
}

function makeLabelSprite(text) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const ctx = labelCanvas.getContext("2d");
  ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  ctx.fillStyle = "rgba(7, 8, 10, 0.72)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  roundRect(ctx, 18, 28, 476, 64, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 61);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.36, 0.09, 1);
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function addStars() {
  const count = 5200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const radius = 30 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    const bright = Math.pow(Math.random(), 4);
    const warmth = 0.65 + Math.random() * 0.35;
    const bri = 0.45 + bright * 0.55;
    colors[i * 3] = warmth * bri;
    colors[i * 3 + 1] = warmth * (0.84 + Math.random() * 0.16) * bri;
    colors[i * 3 + 2] = warmth * (0.78 + Math.random() * 0.22) * bri;
    sizes[i] = 1.0 + bright * 2.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.4,
    vertexColors: true,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  stars = new THREE.Points(geometry, material);
  scene.add(stars);
}

function onPointerMove(event) {
  if (!terrainMesh || !flood) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const [hit] = raycaster.intersectObject(terrainMesh, false);
  if (!hit) return;

  const normal = hit.point.clone().normalize();
  const latitude = THREE.MathUtils.radToDeg(Math.asin(normal.y));
  const longitude = (THREE.MathUtils.radToDeg(Math.atan2(normal.z, normal.x)) + 180 + 360) % 360;
  const height = sampleHeight(meta, heightData, latitude, longitude);
  const surface = sampleFloodMask(meta, flood.mask, latitude, longitude) ? t("land.surface.water") : t("land.surface.dry");
  mapMarker = { latitude, longitude };
  drawMinimapMarker();
  el.cursorOutput.textContent = `${latitude.toFixed(2)} deg, ${longitude.toFixed(2)} deg / ${formatMeters(height)} / ${surface}`;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

let prevTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - prevTime) / 1000);
  prevTime = now;
  controls.update();
  updateLabelVisibility();
  if (stars) stars.rotation.y += 0.00008;
  atmosphere.tick(dt);
  if (waterMaterial) waterMaterial.uniforms.uTime.value += dt;
  if (atmosphere.clouds) {
    terrainUniforms.uCloudOffset.value.x = -atmosphere.clouds.rotation.y / (2 * Math.PI);
  }
  renderer.render(scene, camera);
}

function formatMeters(value) {
  return `${Math.round(value).toLocaleString(localeForNumbers())} m`;
}

let timelapseAnim = null;
async function runSeaTimelapse() {
  if (timelapseAnim) return;
  const original = state.seaLevel;
  const stops = [-9000, -5000, -2000, 0, 1500, 3500, 6000, 8500, 11000, 6000, 2000, 0];
  for (const level of stops) {
    timelapseAnim = level;
    setSeaLevel(level);
    await wait(700);
  }
  timelapseAnim = null;
  setSeaLevel(original);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function copyShareLink() {
  const params = new URLSearchParams();
  params.set("sea", String(state.seaLevel));
  params.set("scale", String(state.verticalScale));
  params.set("visual", state.visualMode);
  params.set("res", state.resolution);
  if (state.ultraCreative) params.set("ultra", state.ultraIntensity);
  if (!state.atmosphere) params.set("atm", "0");
  if (state.clouds) params.set("clouds", "1");
  if (!state.snowCaps) params.set("snow", "0");
  if (!state.biomes) params.set("bio", "0");
  if (!state.tributariesVisible) params.set("trib", "0");
  const cam = camera.position;
  params.set("cam", `${cam.x.toFixed(3)},${cam.y.toFixed(3)},${cam.z.toFixed(3)}`);
  const url = `${window.location.origin}${window.location.pathname}#${params.toString()}`;
  navigator.clipboard.writeText(url).then(
    () => {
      const old = el.shareButton.textContent;
      el.shareButton.textContent = t("btn.shareCopied");
      setTimeout(() => (el.shareButton.textContent = old), 1500);
    },
    () => {
      window.prompt("Copia el link:", url);
    },
  );
}

function applyShareState() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  if (params.has("sea")) state.seaLevel = Number(params.get("sea")) || 0;
  if (params.has("scale")) state.verticalScale = Number(params.get("scale")) || 18;
  if (params.has("visual")) state.visualMode = params.get("visual");
  if (params.has("res")) state.resolution = params.get("res");
  if (params.has("ultra")) {
    state.ultraCreative = true;
    state.ultraIntensity = params.get("ultra");
  }
  if (params.get("atm") === "0") state.atmosphere = false;
  if (params.get("clouds") === "1") state.clouds = true;
  if (params.get("snow") === "0") state.snowCaps = false;
  if (params.get("bio") === "0") state.biomes = false;
  if (params.get("trib") === "0") state.tributariesVisible = false;
  if (params.has("cam")) {
    const [x, y, z] = params.get("cam").split(",").map(Number);
    if ([x, y, z].every(Number.isFinite)) camera.position.set(x, y, z);
  }
  syncControlsToState();
}

function syncControlsToState() {
  if (el.seaLevel) el.seaLevel.value = String(state.seaLevel);
  if (el.seaNumber) el.seaNumber.value = String(state.seaLevel);
  if (el.heightScale) el.heightScale.value = String(state.verticalScale);
  el.visualButtons.forEach((b) => b.classList.toggle("active", b.dataset.visualMode === state.visualMode));
  el.resolutionButtons.forEach((b) => b.classList.toggle("active", b.dataset.resolution === state.resolution));
  el.ultraButtons.forEach((b) => b.classList.toggle("active", b.dataset.ultraIntensity === state.ultraIntensity));
  if (el.ultraToggle) el.ultraToggle.checked = state.ultraCreative;
  if (el.snowToggle) el.snowToggle.checked = state.snowCaps;
  if (el.polarToggle) el.polarToggle.checked = state.polarIce;
  if (el.biomeToggle) el.biomeToggle.checked = state.biomes;
  if (el.tributariesToggle) el.tributariesToggle.checked = state.tributariesVisible;
  if (el.atmosphereToggle) el.atmosphereToggle.checked = state.atmosphere;
  if (el.cloudsToggle) el.cloudsToggle.checked = state.clouds;
  atmosphere.setVisible(state.atmosphere);
  atmosphere.setCloudsVisible(state.clouds);
  atmosphere.setVisualMode(state.visualMode);
}
