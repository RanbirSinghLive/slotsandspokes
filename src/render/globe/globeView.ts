import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { geoInterpolate } from 'd3-geo';
import { airports } from '../airports';
import { flightInterpolator } from '../flightPath';
import { seatsADayByMarket, widthForSeats } from '../routeWidth';
import { isOnTimeArrival } from '../../sim/delays';
import { classRank } from '../../sim/aircraftClasses';
import { greatCircleDistanceNm } from '../../sim/geo';
import { OTP_BASELINE, trailingMarketOtp } from '../../sim/routeOtp';
import { marketKey } from '../../sim/schedule';
import type { SimState } from '../../sim/state';
import { atmosphereMaterial, surfaceMaterial } from './earthMaterials';

/**
 * The globe view (WEEK-TWENTYSEVEN.md): the same game drawn on a three.js
 * globe in the S2 "lifted arcs" look. It only reads `state`, like every
 * renderer, and draws three things over the Earth:
 *
 * - your routes as arcs that rise with distance, each with a dark casing
 *   and a soft shadow on the ground under it, so a line reads over any
 *   colour of land or sea,
 * - every plane in the air, riding its arc, with its own shadow below,
 * - your airports, with their codes.
 *
 * Three.js in two sentences: a scene is a list of objects (meshes) placed
 * in 3D, and a camera looks at it; every frame, renderer.render() asks the
 * graphics chip to draw what the camera sees. Most of the work below is
 * building those meshes from the game's routes and moving them as the
 * clock runs.
 */

// The Earth has radius 1; everything else is in those units.
const SHADOW_RADIUS = 1.0015;
const MAX_ARC_LIFT = 0.18;
const ARC_SAMPLES = 64;
// Everything drawn over the Earth is marked transparent, even when fully
// opaque, so that three.js draws it all in one list in renderOrder: ground
// shadows, then arcs, then planes and airports on top.

const COLORS = {
  space: '#02060c',
  casing: '#0a2440',
  shadow: '#00111f',
  route: '#7fe3ff',
  longHaul: '#ffd34d',
  late: '#ffb347',
  plane: '#ffffff',
  airport: '#ffffff',
};
// A route this long or longer is long-haul and drawn gold.
const LONG_HAUL_NM = 2500;
// Sizes on screen, in CSS pixels, whatever the zoom.
const PLANE_PX = 20;
const DOT_PX = 3.5;
const HOME_DOT_PX = 5.5;
// Labels closer than this on screen than one already shown are left out.
const LABEL_GAP_PX = 34;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/** A longitude and latitude in degrees as a point on (or above) the globe. */
function toVector(lon: number, lat: number, radius = 1, target = new THREE.Vector3()): THREE.Vector3 {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  return target.set(radius * Math.cos(phi) * Math.cos(lambda), radius * Math.sin(phi), -radius * Math.cos(phi) * Math.sin(lambda));
}

/** How high an arc rises at its middle: higher the further it flies, up to MAX_ARC_LIFT. */
function arcPeak(angularDistance: number): number {
  return Math.min(MAX_ARC_LIFT, 0.01 + 0.5 * angularDistance);
}

/** Where the sun is overhead right now: the same formula as the 2D terminator (render/terminator.ts). */
function sunDirection(simMinute: number, startDayOfYear: number, target: THREE.Vector3): THREE.Vector3 {
  const dayOfYear = (startDayOfYear + Math.floor(simMinute / 1440)) % 365;
  const minuteOfDay = ((simMinute % 1440) + 1440) % 1440;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const subsolarLon = -(minuteOfDay - 720) / 4;
  return toVector(subsolarLon, declination, 1, target).normalize();
}

function loadTexture(loader: THREE.TextureLoader, url: string): THREE.Texture {
  const texture = loader.load(url);
  texture.anisotropy = 4;
  return texture;
}

type RouteDraw = { key: string; origin: string; dest: string; width: number; colour: string };

export type GlobeView = {
  render(state: SimState, nowFractionalMinute: number): void;
  resize(): void;
};

export function createGlobeView(container: HTMLElement): GlobeView {
  // Colours in this file are the hex values the look book names, shown as they are.
  THREE.ColorManagement.enabled = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // A phone's 3x screen would triple the pixels to shade for no visible gain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(COLORS.space);
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'globe-labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

  const loader = new THREE.TextureLoader();
  const earthMaterial = surfaceMaterial({
    day: loadTexture(loader, '/globe/earth-day.jpg'),
    night: loadTexture(loader, '/globe/earth-night.jpg'),
    land: loadTexture(loader, '/globe/earth-land.png'),
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), earthMaterial);
  earth.renderOrder = 0;
  scene.add(earth);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32), atmosphereMaterial()));

  // Drag turns the globe, pinch or wheel zooms; no panning off the Earth.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 6;
  controls.zoomSpeed = 0.8;
  camera.position.set(0, 0, 3);
  let framed = false;

  /** Look at the network's middle from far enough out to see all of it: the camera's first view. */
  function frameNetwork(normals: THREE.Vector3[]): void {
    const middle = new THREE.Vector3();
    for (const normal of normals) middle.add(normal);
    if (middle.lengthSq() < 1e-9) middle.set(0, 0, 1);
    middle.normalize();
    const spread = Math.max(0, ...normals.map((normal) => normal.angleTo(middle)));
    // A phone held upright sees less sideways, so it starts further out.
    const aspectRoom = Math.min(1, camera.aspect);
    const distance = THREE.MathUtils.clamp(1 + (0.25 + 2.4 * spread) / aspectRoom, 1.35, 4);
    camera.position.copy(middle).multiplyScalar(distance);
    controls.update();
  }

  // --- Routes: rebuilt only when the set of routes, their widths or their colours change ---
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const lineMaterials: LineMaterial[] = [];
  let routeSignature = '';
  let routeLiftByKey = new Map<string, number>();

  function lineOf(points: number[], colour: string, widthPx: number, opacity: number, order: number): Line2 {
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const material = new LineMaterial({
      color: colour,
      linewidth: widthPx * renderer.getPixelRatio(),
      transparent: true,
      opacity,
      depthWrite: false,
    });
    lineMaterials.push(material);
    const line = new Line2(geometry, material);
    line.renderOrder = order;
    return line;
  }

  function routesToDraw(current: SimState): RouteDraw[] {
    const seats = seatsADayByMarket(current);
    const routes = new Map<string, RouteDraw>();
    for (const leg of current.schedule) {
      const key = marketKey(leg.origin, leg.dest);
      if (routes.has(key)) continue;
      const from = airportsByIata.get(leg.origin);
      const to = airportsByIata.get(leg.dest);
      if (!from || !to) continue;
      const otp = trailingMarketOtp(current, leg.origin, leg.dest).otp;
      const longHaul = greatCircleDistanceNm(from, to) >= LONG_HAUL_NM;
      const colour = otp !== null && otp < OTP_BASELINE ? COLORS.late : longHaul ? COLORS.longHaul : COLORS.route;
      routes.set(key, { key, origin: leg.origin, dest: leg.dest, width: 1.5 + 1.2 * widthForSeats(seats.get(key) ?? 0), colour });
    }
    return [...routes.values()];
  }

  function rebuildRoutes(current: SimState): void {
    const routes = routesToDraw(current);
    const signature = routes.map((r) => `${r.key}:${r.width.toFixed(1)}:${r.colour}`).join('|');
    if (signature === routeSignature) return;
    routeSignature = signature;
    for (const child of [...routeGroup.children]) {
      routeGroup.remove(child);
      (child as Line2).geometry.dispose();
    }
    for (const material of lineMaterials.splice(0)) material.dispose();
    routeLiftByKey = new Map();

    // Thin routes last, so a regional spoke stays visible where it crosses a trunk.
    routes.sort((a, b) => b.width - a.width);
    const point = new THREE.Vector3();
    for (const route of routes) {
      const from = airportsByIata.get(route.origin)!;
      const to = airportsByIata.get(route.dest)!;
      const along = geoInterpolate([from.lon, from.lat], [to.lon, to.lat]);
      const angle = toVector(from.lon, from.lat).angleTo(toVector(to.lon, to.lat));
      const peak = arcPeak(angle);
      routeLiftByKey.set(route.key, peak);
      const arc: number[] = [];
      const ground: number[] = [];
      for (let i = 0; i <= ARC_SAMPLES; i++) {
        const t = i / ARC_SAMPLES;
        const [lon, lat] = along(t);
        toVector(lon, lat, 1 + peak * Math.sin(Math.PI * t), point);
        arc.push(point.x, point.y, point.z);
        toVector(lon, lat, SHADOW_RADIUS, point);
        ground.push(point.x, point.y, point.z);
      }
      routeGroup.add(lineOf(ground, COLORS.shadow, route.width + 1, 0.35, 1));
      routeGroup.add(lineOf(arc, COLORS.casing, route.width + 3, 1, 2));
      routeGroup.add(lineOf(arc, route.colour, route.width, 1, 3));
    }
  }

  // --- Planes and their shadows: one instanced mesh each, so every plane in the air costs one draw ---
  const jet = new THREE.Shape();
  // The look book's airliner, nose along +y, in a 24-unit box.
  const outline: [number, number][] = [
    [0, 12], [1.6, 9], [1.6, 2], [11, -3], [11, -5], [1.6, -2.5], [1.4, -8], [4.5, -10.5], [4.5, -12], [0, -11],
    [-4.5, -12], [-4.5, -10.5], [-1.4, -8], [-1.6, -2.5], [-11, -5], [-11, -3], [-1.6, 2], [-1.6, 9],
  ];
  outline.forEach(([x, y], i) => (i === 0 ? jet.moveTo(x, y) : jet.lineTo(x, y)));
  const planeGeometry = new THREE.ShapeGeometry(jet);
  planeGeometry.scale(1 / 24, 1 / 24, 1 / 24);
  const planeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const shadowGeometry = new THREE.CircleGeometry(0.4, 16);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.4, depthWrite: false });
  let planeCapacity = 0;
  let planes: THREE.InstancedMesh | null = null;
  let planeShadows: THREE.InstancedMesh | null = null;

  function ensurePlaneCapacity(count: number): void {
    if (count <= planeCapacity && planes && planeShadows) return;
    planeCapacity = Math.max(64, count * 2);
    for (const mesh of [planes, planeShadows]) if (mesh) scene.remove(mesh);
    planes = new THREE.InstancedMesh(planeGeometry, planeMaterial, planeCapacity);
    planes.renderOrder = 5;
    planes.frustumCulled = false;
    planeShadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, planeCapacity);
    planeShadows.renderOrder = 1;
    planeShadows.frustumCulled = false;
    scene.add(planeShadows, planes);
  }

  const basis = new THREE.Matrix4();
  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const planeColour = new THREE.Color();

  function placePlanes(current: SimState, nowFractionalMinute: number, size: number): void {
    const classes = new Map(current.aircraft.map((aircraft) => [aircraft.tail, classRank(aircraft.typeCode)]));
    ensurePlaneCapacity(current.activeFlights.length);
    let count = 0;
    for (const flight of current.activeFlights) {
      const from = airportsByIata.get(flight.origin);
      const to = airportsByIata.get(flight.dest);
      if (!from || !to) continue;
      const t = Math.min(Math.max((nowFractionalMinute - flight.departMinute) / (flight.arriveMinute - flight.departMinute), 0), 1);
      const path = flightInterpolator(flight, [from.lon, from.lat], [to.lon, to.lat]);
      const peak = routeLiftByKey.get(marketKey(flight.origin, flight.dest)) ?? arcPeak(toVector(from.lon, from.lat).angleTo(toVector(to.lon, to.lat)));
      const [lon, lat] = path(t);
      const [aheadLon, aheadLat] = path(Math.min(t + 0.002, 1));
      toVector(lon, lat, 1 + peak * Math.sin(Math.PI * t), here);
      toVector(aheadLon, aheadLat, 1 + peak * Math.sin(Math.PI * Math.min(t + 0.002, 1)), ahead);
      up.copy(here).normalize();
      forward.subVectors(ahead, here);
      if (forward.lengthSq() < 1e-12) forward.set(0, 1, 0);
      forward.addScaledVector(up, -forward.dot(up)).normalize();
      right.crossVectors(forward, up).normalize();
      // Bigger classes draw bigger, as on the 2D map.
      const planeSize = size * (0.8 + 0.15 * (classes.get(flight.tail) ?? 0));
      basis.makeBasis(right, forward, up);
      basis.scale(scale.set(planeSize, planeSize, planeSize));
      basis.setPosition(here);
      planes!.setMatrixAt(count, basis);
      planes!.setColorAt(count, planeColour.set(isOnTimeArrival(flight.arriveMinute, flight.scheduledArriveMinute) ? COLORS.plane : COLORS.late));
      // The shadow sits on the ground under the plane; the gap between them is its height.
      basis.makeBasis(right, forward, up);
      basis.scale(scale.set(planeSize, planeSize, planeSize));
      basis.setPosition(toVector(lon, lat, SHADOW_RADIUS, here));
      planeShadows!.setMatrixAt(count, basis);
      count++;
    }
    planes!.count = count;
    planeShadows!.count = count;
    planes!.instanceMatrix.needsUpdate = true;
    planeShadows!.instanceMatrix.needsUpdate = true;
    if (planes!.instanceColor) planes!.instanceColor.needsUpdate = true;
  }

  // --- Airports: a white dot with a dark rim, and its code ---
  const airportGroup = new THREE.Group();
  scene.add(airportGroup);
  const dotGeometry = new THREE.CircleGeometry(1, 20);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: COLORS.airport, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const rimMaterial = new THREE.MeshBasicMaterial({ color: COLORS.casing, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  type AirportMark = { iata: string; normal: THREE.Vector3; dot: THREE.Mesh; rim: THREE.Mesh; label: CSS2DObject; home: boolean };
  let airportMarks: AirportMark[] = [];
  let airportSignature = '';

  function rebuildAirports(current: SimState): void {
    const codes = [...new Set(current.schedule.flatMap((leg) => [leg.origin, leg.dest]))].sort();
    if (!codes.includes(current.homeAirport)) codes.push(current.homeAirport);
    const signature = codes.join(',');
    if (signature === airportSignature) return;
    airportSignature = signature;
    for (const mark of airportMarks) {
      airportGroup.remove(mark.dot, mark.rim, mark.label);
      mark.label.element.remove();
    }
    airportMarks = [];
    for (const iata of codes) {
      const airport = airportsByIata.get(iata);
      if (!airport) continue;
      const normal = toVector(airport.lon, airport.lat).normalize();
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      const rim = new THREE.Mesh(dotGeometry, rimMaterial);
      for (const mesh of [rim, dot]) {
        mesh.position.copy(normal).multiplyScalar(SHADOW_RADIUS + 0.0005);
        mesh.lookAt(normal.clone().multiplyScalar(2));
      }
      rim.renderOrder = 6;
      dot.renderOrder = 7;
      const element = document.createElement('span');
      element.className = iata === current.homeAirport ? 'globe-label is-home' : 'globe-label';
      element.textContent = iata;
      const label = new CSS2DObject(element);
      label.position.copy(normal).multiplyScalar(1.004);
      label.center.set(0, 0.5);
      airportGroup.add(rim, dot, label);
      airportMarks.push({ iata, normal, dot, rim, label, home: iata === current.homeAirport });
    }
    // Home first, so it always keeps its label when codes crowd.
    airportMarks.sort((a, b) => Number(b.home) - Number(a.home));
    if (!framed) {
      framed = true;
      frameNetwork(airportMarks.map((mark) => mark.normal));
    }
  }

  const sun = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const startRealMs = performance.now();

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    labels.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const material of lineMaterials) material.resolution.copy(drawing);
  }

  function render(current: SimState, nowFractionalMinute: number): void {
    // Slower turning when zoomed in, so a drag over a hub doesn't spin the planet.
    const distance = camera.position.length();
    controls.rotateSpeed = Math.min(1, 0.35 * (distance - 1));
    controls.update();

    sunDirection(nowFractionalMinute, current.startDayOfYear ?? 0, sun);
    earthMaterial.uniforms.sunDirection!.value.copy(sun);
    // Clouds drift with real time, not game time, so 100x doesn't whip them round the planet.
    earthMaterial.uniforms.cloudTime!.value = (performance.now() - startRealMs) / 120000;

    rebuildRoutes(current);
    rebuildAirports(current);
    const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const material of lineMaterials) material.resolution.copy(drawing);

    // Marks keep their size on screen as you zoom: one screen pixel, in globe
    // units, at the surface under the camera.
    const pixel = (2 * (distance - 1) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, container.clientHeight);
    placePlanes(current, nowFractionalMinute, PLANE_PX * pixel);
    cameraDirection.copy(camera.position).normalize();
    const shown: THREE.Vector2[] = [];
    const width = container.clientWidth;
    const height = container.clientHeight;
    for (const mark of airportMarks) {
      const radius = pixel * (mark.home ? HOME_DOT_PX : DOT_PX);
      mark.dot.scale.setScalar(radius);
      mark.rim.scale.setScalar(radius * 1.5);
      // A code on the far side of the Earth, on its edge, or crowding one already shown is hidden.
      const onScreen = screen.copy(mark.normal).project(camera);
      const at = new THREE.Vector2(((onScreen.x + 1) / 2) * width, ((1 - onScreen.y) / 2) * height);
      const visible = mark.normal.dot(cameraDirection) > 0.25 && shown.every((other) => other.distanceTo(at) >= LABEL_GAP_PX);
      mark.label.visible = visible;
      if (visible) shown.push(at);
    }

    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  resize();
  return { render, resize };
}
