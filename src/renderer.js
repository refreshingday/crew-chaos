import * as THREE from 'three';
import { ADDONS } from './addons.js';
import { GAME_CONSTANTS } from './game.js';
import { OCEAN_GLSL, sampleOceanHeight } from './ocean.js';

// All art is generated locally: small shared meshes, no network assets or textures.
const C = {
  cream: 0xfff3cf, wood: 0xeebd79, darkWood: 0xa06443, navy: 0x173e59,
  coral: 0xf16757, red: 0xdd4d49, white: 0xffffff, gold: 0xffcd55,
  teal: 0x148a92, whale: 0x416886, whaleLight: 0x92c8ce,
};
const TAU = Math.PI * 2;

export class CrewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb9ebed);
    this.scene.fog = new THREE.Fog(0xb9ebed, 95, 190);
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 280);
    this.world = new THREE.Group();
    this.world.scale.x = -1; // The camera looks forward: mirror the art so +x is screen-right.
    this.scene.add(this.world);
    this.materials = new Map();
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      sphere: new THREE.SphereGeometry(1, 12, 8),
      ball: new THREE.IcosahedronGeometry(1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
      cone: new THREE.ConeGeometry(1, 1, 8),
      ring: new THREE.TorusGeometry(1, 0.16, 6, 24),
    };
    this.playerMeshes = new Map();
    this.obstacleMeshes = new Map();
    this.waveMeshes = new Map();
    this.snackBadges = new Map();
    this.impactSeen = new Set();
    this.impactPool = [];
    this.lastStateTime = 0;
    this.oceanTime = 0;
    this.oceanAmplitude = 1;
    this.tempVector = new THREE.Vector3();
    this.projectVector = new THREE.Vector3();
    this.clock = 0;
    this.reducedMotion = false;
    this.cameraPosition = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.initialized = false;
    this.scene.add(new THREE.HemisphereLight(0xe7fdff, 0x4e938e, 2.5));
    this.sun = new THREE.DirectionalLight(0xffefd0, 3.2);
    this.sun.position.set(-15, 30, -20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 90 });
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun, this.sun.target);
    this.makeOcean();
    this.boat = this.makeBoat();
    this.world.add(this.boat);
    this.prepareBoatMaterials();
    this.makeBoatEffects();
    this.makeImpactPool();
    this.makeScenery();
    this.makeWake();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  mat(color, options = {}) {
    const key = `${color}-${JSON.stringify(options)}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options }));
    return this.materials.get(key);
  }

  mesh(parent, shape, color, position = [0, 0, 0], scale = [1, 1, 1], options = {}) {
    const item = new THREE.Mesh(this.geo[shape] || shape, this.mat(color, options));
    item.position.set(...position);
    item.scale.set(...scale);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }

  beam(parent, a, b, radius, color) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const object = this.mesh(parent, 'cylinder', color, start.clone().add(end).multiplyScalar(0.5).toArray(), [radius, delta.length(), radius]);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return object;
  }

  batchStatic(group, excluded = [], shadows = true) {
    // Keep the handcrafted detail, but draw repeated parts together on mobile GPUs.
    group.updateMatrixWorld(true);
    const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert();
    const batches=new Map();
    group.traverse(object=>{
      if(!object.isMesh||excluded.includes(object)) return;
      const key=`${object.geometry.uuid}/${object.material.uuid}`;
      if(!batches.has(key)) batches.set(key,[]);
      batches.get(key).push({object,matrix:new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld)});
    });
    for(const entries of batches.values()) {
      const first=entries[0].object;
      const batch=new THREE.InstancedMesh(first.geometry,first.material,entries.length);
      entries.forEach((entry,index)=>{batch.setMatrixAt(index,entry.matrix);entry.object.removeFromParent();});
      batch.castShadow=shadows;batch.receiveShadow=shadows;
      batch.computeBoundingSphere();group.add(batch);
    }
  }

  makeOcean() {
    // ~36k vertices / one draw call: enough samples for real curved silhouettes,
    // without reflection render targets, CPU vertex updates or a water postpass.
    const geometry = new THREE.PlaneGeometry(240, 320, 160, 224);
    geometry.rotateX(-Math.PI / 2);
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTravel: { value: 0 }, uWorldX: { value: 0 }, uAmplitude: { value: 1 }, uFog: { value: new THREE.Color(0xb9ebed) } },
      vertexShader: `
        uniform float uTime; uniform float uTravel; uniform float uWorldX; uniform float uAmplitude;
        varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal;
        varying vec2 vCrests; varying float vDepth;
        ${OCEAN_GLSL}
        void main() {
          vec3 p = position; float z = p.z + uTravel; float x = p.x + uWorldX;
          vec3 surface = oceanSurface(x,z,uTime,vCrests);
          p.y = surface.x;
          vNormal = mat3(modelMatrix) * vec3(-surface.y,1.,-surface.z);
          vec4 world = modelMatrix * vec4(p,1.);
          vWorld = world.xyz;
          vPos = vec3(x,p.y,z);
          vec4 mv = viewMatrix * world; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uFog;
        varying vec3 vPos; varying vec3 vWorld; varying vec3 vNormal;
        varying vec2 vCrests; varying float vDepth;
        float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p) {
          vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
        }
        void main() {
          // Lighting follows displaced geometry. Tiny capillary detail only
          // perturbs reflection; it cannot turn the swells into a checkerboard.
          vec3 normal = normalize(vNormal + vec3(
            .025*cos(vPos.x*1.8+vPos.z*2.1+uTime*2.7),0.,
            .035*cos(vPos.z*2.4+.7*sin(vPos.x*.7)+uTime*3.2)));
          vec3 view = normalize(cameraPosition-vWorld);
          vec3 sun = normalize(vec3(-.45,.8,-.55));
          float diffuse = max(0.,dot(normal,sun));
          float elevation = smoothstep(-1.65,1.65,vPos.y);
          float face = smoothstep(-.35,.38,normal.z);
          vec3 water = mix(vec3(.006,.065,.19),vec3(.015,.40,.49),elevation);
          water = mix(water,vec3(.025,.59,.58),elevation*face*.5);
          water *= .65 + diffuse*.48;
          float fresnel = pow(1.-max(0.,dot(normal,view)),4.);
          water = mix(water,vec3(.32,.69,.79),fresnel*.6);
          float glint = pow(max(0.,dot(normal,normalize(sun+view))),110.);
          water += vec3(1.,.91,.69)*glint*.8;
          // Broken, curving foam ribbons live on physical crests, never on a
          // fixed UV grid. Distant ribbons fade before becoming subpixel noise.
          float breakup = noise(vec2(vPos.x*.16,vPos.z*.12-uTime*.025));
          float grain = noise(vPos.xz*2.4);
          float edge = noise(vPos.xz*.9)*.016;
          float crest = smoothstep(.961+edge,.985,vCrests.x);
          float secondary = smoothstep(.98,1.,vCrests.y)*smoothstep(.35,1.1,vPos.y)*.3;
          float foam = max(crest,secondary)*smoothstep(.40,.52,breakup);
          foam *= .4+.6*smoothstep(.25,.58,grain);
          foam *= 1.-smoothstep(65.,135.,vDepth);
          water = mix(water,vec3(.79,.98,.90),foam*.9);
          float fog = smoothstep(80.,180.,vDepth);
          gl_FragColor = vec4(mix(water,uFog,fog),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(geometry, this.oceanMaterial);
    this.ocean.position.y = 0;
    this.ocean.frustumCulled = false;
    this.world.add(this.ocean);
  }

  makeBoat() {
    const boat = new THREE.Group();
    const outline = GAME_CONSTANTS.BOAT_OUTLINE;
    const hullVertices = [], hullIndices = [];
    for (let ring = 0; ring < 3; ring++) {
      const scale = [0.72, 0.94, 1][ring], height = [0.15, 0.55, 1.65][ring];
      for (const [x,z] of outline) hullVertices.push(x*scale,height,z*scale);
    }
    const count = outline.length;
    for (let r=0;r<2;r++) for(let i=0;i<count;i++) {
      const j=(i+1)%count,a=r*count+i,b=r*count+j,c=(r+1)*count+i,d=(r+1)*count+j;
      hullIndices.push(a,c,b,b,c,d);
    }
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(hullVertices,3));
    hullGeo.setIndex(hullIndices); hullGeo.computeVertexNormals();
    this.mesh(boat,hullGeo,C.coral,[0,0,0],[1,1,1],{ side:THREE.DoubleSide });
    const deckShape = new THREE.Shape();
    outline.forEach(([x,z],i)=> i ? deckShape.lineTo(x,z) : deckShape.moveTo(x,z));
    deckShape.closePath();
    const deckGeo = new THREE.ShapeGeometry(deckShape); deckGeo.rotateX(Math.PI/2);
    this.mesh(boat,deckGeo,C.wood,[0,1.78,0],[0.98,1,0.98],{ side:THREE.DoubleSide });
    for(let i=0;i<count;i++) {
      const a=outline[i],b=outline[(i+1)%count];
      this.beam(boat,[a[0],1.79,a[1]],[b[0],1.79,b[1]],.13,C.cream);
      this.beam(boat,[a[0]*.965,1.25,a[1]*.965],[b[0]*.965,1.25,b[1]*.965],.07,C.navy);
    }
    // Plank joints, nail heads, and a central navy walking strip give the deck scale.
    for(let z=-2.75;z<3.3;z+=.64) {
      const width=z>1.6?7.7-(z-1.6)*2.2:8.05;
      this.mesh(boat,'box',0xc78f58,[0,1.791,z],[width,.012,.025]);
      for(const x of [-width*.41,width*.41]) this.mesh(boat,'sphere',C.darkWood,[x,1.81,z+.12],[.032,.012,.032]);
    }
    for(const side of [-1,1]) {
      for(const z of [-2.6,-1.55,1.15,2.25]) {
        const x=side*(z>2?3.55:4.05);
        this.mesh(boat,'cylinder',C.cream,[x,2.13,z],[.095,.65,.095]);
        this.mesh(boat,'sphere',C.gold,[x,2.47,z],[.13,.1,.13]);
      }
      this.beam(boat,[side*4.05,2.43,-2.6],[side*4.05,2.43,-1.55],.065,C.cream);
      this.beam(boat,[side*4.05,2.43,1.15],[side*3.55,2.43,2.25],.065,C.cream);
      const lifeRing=this.mesh(boat,'ring',C.cream,[side*4.17,1.39,-1.8],[.45,.45,.45]);
      lifeRing.rotation.y=Math.PI/2;
      for(let i=0;i<4;i++) {
        const ang=i*Math.PI/2;
        this.mesh(boat,'sphere',C.red,[side*4.19,1.39+Math.sin(ang)*.45,-1.8+Math.cos(ang)*.45],[.1,.13,.13]);
      }
      // Rope ladder marks the open rescue gap on either side.
      for(const z of [-.55,.1]) this.beam(boat,[side*4.32,.05,z],[side*4.32,1.78,z],.035,C.cream);
      for(let y=.15;y<1.7;y+=.36) this.beam(boat,[side*4.35,y,-.58],[side*4.35,y,.13],.055,C.darkWood);
      this.mesh(boat,'sphere',C.navy,[side*4.22,.8,-2.5],[.28,.44,.26]);
    }
    // Low stern bench, a tiny wheel, and a tall narrow pennant leave the deck readable.
    this.mesh(boat,'box',C.navy,[0,2.02,-2.65],[2.2,.45,.55]);
    this.mesh(boat,'box',C.cream,[0,2.28,-2.65],[2.4,.12,.68]);
    this.mesh(boat,'cylinder',C.darkWood,[0,2.3,-1.95],[.13,1,.13]);
    const wheel=this.mesh(boat,'ring',C.darkWood,[0,2.85,-1.9],[.48,.48,.48]);
    wheel.rotation.x=.4;
    for(let i=0;i<6;i++) { const a=i*TAU/6; this.beam(boat,[0,2.85,-1.9],[Math.cos(a)*.6,2.85+Math.sin(a)*.55,-1.9+Math.sin(a)*.18],.045,C.darkWood); }
    this.mesh(boat,'cylinder',C.cream,[0,3.82,2.75],[.085,4.1,.085]);
    this.mesh(boat,'sphere',C.gold,[0,5.95,2.75],[.16,.16,.16]);
    const flagGeo=new THREE.BufferGeometry();
    flagGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1.8,-.22,.08,0,-.85,0],3));
    flagGeo.computeVertexNormals();
    this.flag=this.mesh(boat,flagGeo,C.coral,[0,5.7,2.75],[1,1,1],{side:THREE.DoubleSide});
    this.mesh(boat,'box',C.navy,[0,1.98,3.32],[.9,.34,.55]);
    // Bow lamp.
    this.mesh(boat,'sphere',C.gold,[0,2.22,3.33],[.24,.2,.24],{emissive:0xffb54c,emissiveIntensity:.28});
    this.batchStatic(boat,[this.flag]);
    return boat;
  }

  prepareBoatMaterials() {
    // Boat-only copies make spectral opacity and impact flashes reversible.
    const copies=new Map();
    this.boatMaterials=[];
    this.boat.traverse(object=>{
      if(!object.isMesh) return;
      const source=object.material;
      if(!copies.has(source)) {
        const material=source.clone();
        copies.set(source,material);
        this.boatMaterials.push({material,color:source.color.clone(),emissive:source.emissive.clone(),emissiveIntensity:source.emissiveIntensity});
      }
      object.material=copies.get(source);
    });
  }

  makeBoatEffects() {
    const root=new THREE.Group();this.world.add(root);
    const tentacles=new THREE.Group();root.add(tentacles);
    if(!this.geo.tentacle) {
      const curve=new THREE.CatmullRomCurve3([
        new THREE.Vector3(0,0,0),new THREE.Vector3(.6,.25,0),new THREE.Vector3(1.25,1.25,.1),
        new THREE.Vector3(1.9,1.8,.1),new THREE.Vector3(2.35,1.25,.1),new THREE.Vector3(2.05,.95,.1),
      ]);
      this.geo.tentacle=new THREE.TubeGeometry(curve,18,.19,7,false);
    }
    for(const side of [-1,1]) for(const z of [-1.7,1.3]) {
      const arm=new THREE.Group();arm.position.set(side*3.7,1,z);tentacles.add(arm);
      this.mesh(arm,'tentacle',0xac81e8,[0,0,0],[side,1,1]);
      for(let n=0;n<3;n++) this.mesh(arm,'sphere',0xf1c9ee,[side*(1.2+n*.3),1.25+n*.17,-.09],[.105,.12,.06]);
    }
    const coins=new THREE.Group();root.add(coins);
    for(let i=0;i<6;i++) {
      const a=i*TAU/6;
      const coin=this.mesh(coins,'cylinder',C.gold,[Math.cos(a)*5.5,1.7,Math.sin(a)*4.1],[.35,.1,.35],{metalness:.25,roughness:.4});coin.rotation.x=Math.PI/2;
    }
    const disco=new THREE.Group();root.add(disco);
    for(let i=0;i<7;i++) {
      const a=i*TAU/7,color=[0xff91c8,0x7bffdf,0xffe280,0xafb1ff][i%4];
      const petal=this.mesh(disco,'sphere',color,[Math.cos(a)*4.9,2.5,Math.sin(a)*3.8],[.36,.09,.58],{emissive:color,emissiveIntensity:.65});petal.rotation.y=-a;
    }
    this.mesh(disco,'ball',0xe2f5ff,[0,6.4,2.75],[.39,.39,.39],{metalness:.6,roughness:.15});
    const thunder=new THREE.Group();root.add(thunder);
    for(let i=0;i<2;i++) {
      const ring=this.mesh(thunder,'ring',i?0xfff8a0:0xa9f8ff,[0,.1+i*.12,0],[5+i,5+i,5+i],{emissive:0x8beeff,emissiveIntensity:1.1});ring.rotation.x=Math.PI/2;ring.castShadow=false;
    }
    const ghost=this.mesh(root,'ring',0xd3c7ff,[0,.2,0],[4.8,3.8,4.8],{transparent:true,opacity:.55,emissive:0x9cbbff,emissiveIntensity:.5,depthWrite:false});
    ghost.rotation.x=Math.PI/2;ghost.castShadow=false;
    this.boatEffects={root,tentacles,coins,disco,thunder,ghost};
  }

  makePlayerEffects(root) {
    const effects={};
    const group=(name)=>{const g=new THREE.Group();g.visible=false;root.add(g);effects[name]=g;return g;};
    const balloon=group('balloon');
    this.beam(balloon,[.18,1.1,0],[.45,3.9,.08],.018,C.cream);
    this.mesh(balloon,'sphere',0xff8eb3,[.45,4.45,.08],[.51,.65,.5],{roughness:.35});
    this.mesh(balloon,'sphere',0xffdeeb,[.24,4.65,-.32],[.11,.2,.045]);
    this.mesh(balloon,'cone',0xff8eb3,[.45,3.87,.08],[.12,.17,.12]);
    const jelly=group('jelly');
    this.mesh(jelly,'sphere',0xd79af5,[0,1.9,0],[.61,.4,.52],{transparent:true,opacity:.6,depthWrite:false});
    for(let i=0;i<4;i++)this.mesh(jelly,'sphere',0xefc5ff,[(i-1.5)*.23,1.7,-.4],[.12,.18,.1]);
    const chili=group('chili');
    for(let i=0;i<5;i++){const a=i*TAU/5;this.mesh(chili,'cone',i%2?C.gold:C.coral,[Math.cos(a)*.65,.4,Math.sin(a)*.65],[.13,.55,.13],{emissive:C.coral,emissiveIntensity:.4});}
    const anchor=group('anchor');
    this.beam(anchor,[0,.3,.6],[0,1.35,.6],.07,C.navy);
    this.beam(anchor,[-.42,.55,.6],[.42,.55,.6],.07,C.navy);
    this.mesh(anchor,'ring',C.gold,[0,1.35,.6],[.16,.16,.16]);
    for(const side of [-1,1]){const tip=this.mesh(anchor,'cone',C.navy,[side*.4,.75,.6],[.14,.32,.1]);tip.rotation.z=-side*.35;}
    const magnet=group('magnet');
    if(!this.geo.halfRing)this.geo.halfRing=new THREE.TorusGeometry(.35,.1,6,12,Math.PI);
    this.mesh(magnet,'halfRing',C.coral,[0,2.55,0],[1,1,1]);
    for(const side of [-1,1])this.mesh(magnet,'box',C.cream,[side*.35,2.48,0],[.2,.23,.2]);
    const ghost=group('ghost');
    this.mesh(ghost,'sphere',0xc8cdff,[0,1.15,0],[.75,1.27,.63],{transparent:true,opacity:.2,emissive:0x919dff,emissiveIntensity:.3,depthWrite:false}).castShadow=false;
    const banana=group('banana');
    for(const side of [-1,1]){const peel=this.mesh(banana,'halfRing',0xffdf53,[side*.27,.16,-.1],[.75,.75,.75]);peel.rotation.x=-Math.PI/2;peel.rotation.y=side*.6;}
    const disco=group('disco');
    for(let i=0;i<4;i++){const a=i*TAU/4,color=[0xff8fcc,0x7affda,0xffd36a,0xaa8cff][i];this.mesh(disco,'ball',color,[Math.cos(a)*.9,1.5,Math.sin(a)*.9],[.13,.2,.13],{emissive:color,emissiveIntensity:.65});}
    const thunder=group('thunder');
    if(!this.geo.bolt){const shape=new THREE.Shape();[[-.05,.8],[.36,.8],[.08,.22],[.36,.22],[-.23,-.65],[-.06,-.08],[-.36,-.08]].forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();this.geo.bolt=new THREE.ShapeGeometry(shape);}
    this.mesh(thunder,'bolt',0xffee7d,[0,2.8,0],[.65,.65,.65],{emissive:0xffdd69,emissiveIntensity:.65,side:THREE.DoubleSide});
    const octopus=group('octopus');
    this.mesh(octopus,'sphere',0xbf91e8,[0,2.08,0],[.52,.34,.42]);
    for(const side of [-1,1]){
      this.mesh(octopus,'sphere',C.cream,[side*.17,2.12,-.38],[.1,.1,.04]);
      this.mesh(octopus,'sphere',C.navy,[side*.17,2.12,-.42],[.045,.055,.025]);
      this.mesh(octopus,'tentacle',0xbf91e8,[side*.33,1.87,0],[side*.28,.28,.3]);
    }
    return effects;
  }

  makeImpactPool() {
    if(!this.geo.star){
      const shape=new THREE.Shape();
      for(let i=0;i<10;i++){const a=i*Math.PI/5+Math.PI/2,r=i%2?.2:.48,x=Math.cos(a)*r,y=Math.sin(a)*r;i?shape.lineTo(x,y):shape.moveTo(x,y);}
      shape.closePath();this.geo.star=new THREE.ShapeGeometry(shape);
    }
    for(let i=0;i<8;i++) {
      const root=new THREE.Group();root.visible=false;this.world.add(root);
      const ringMaterial=new THREE.MeshStandardMaterial({color:0xe6fff4,emissive:0x8de7e6,emissiveIntensity:.25,transparent:true,opacity:1,depthWrite:false,roughness:.6});
      const rings=[];
      for(let n=0;n<2;n++){const ring=new THREE.Mesh(this.geo.ring,ringMaterial);ring.rotation.x=Math.PI/2;root.add(ring);rings.push(ring);}
      const particles=[];
      for(let n=0;n<22;n++){
        const foam=n<12,wood=n>=18;
        const mesh=this.mesh(root,foam?'sphere':wood?'box':'star',foam?C.white:wood?C.wood:n%2?C.gold:C.cream,[0,0,0],[1,1,1],foam?{}:{side:THREE.DoubleSide,emissive:wood?0x000000:0xffc769,emissiveIntensity:.3});
        mesh.castShadow=false;
        const angle=n*2.39996;
        particles.push({mesh,geometry:mesh.geometry,material:mesh.material,foam,wood,dx:Math.cos(angle),dz:Math.sin(angle),lift:3.4+(n%5)*.62,speed:2+(n%4)*.75,spin:n*.83});
      }
      this.impactPool.push({root,rings,particles,ringMaterial,event:null});
    }
  }

  updateImpacts(state,t) {
    const now=Number.isFinite(state.time)?state.time:0;
    if(now<this.lastStateTime-.5){this.impactSeen.clear();for(const slot of this.impactPool){slot.event=null;slot.root.visible=false;}}
    this.lastStateTime=now;
    for(const impact of state.impacts||[]) {
      if(this.impactSeen.has(impact.id))continue;
      this.impactSeen.add(impact.id);
      if(this.impactSeen.size>96)this.impactSeen.delete(this.impactSeen.values().next().value);
      const age=now-impact.at;
      if(age<-.1||age>1.15)continue;
      const slot=this.impactPool.find(item=>!item.event)||this.impactPool.reduce((a,b)=>a.event.at<b.event.at?a:b);
      slot.event=impact;slot.root.visible=true;
    }
    let flash=0,waveFlash=0,shake=0;
    for(const slot of this.impactPool) {
      if(!slot.event)continue;
      const impact=slot.event,wave=impact.kind==='wave',age=Math.max(0,now-impact.at),life=wave?1.25:impact.blocked?.85:1.15;
      if(age>life){slot.event=null;slot.root.visible=false;continue;}
      const progress=age/life,fade=1-progress;
      const water=this.waterHeight(impact.x,impact.z);
      slot.root.position.set(impact.x,water+.13,impact.z);
      slot.ringMaterial.opacity=fade*.88;
      slot.ringMaterial.color.set(wave?0xc4ffff:impact.blocked?0xc7baff:impact.kind==='thunder'?0xc8faff:0xf4ffed);
      for(let i=0;i<2;i++){
        const radius=this.reducedMotion?2.2+i*.8:(wave?2.8:.7)+age*(impact.kind==='thunder'?15:wave?8:6)+i*.65;
        slot.rings[i].scale.set(radius,radius,.26);slot.rings[i].position.y=.06+i*.1;
      }
      for(const particle of slot.particles){
        const p=particle,mesh=p.mesh,movingAge=this.reducedMotion?.18:age;
        mesh.geometry=wave?this.geo.sphere:p.geometry;
        mesh.material=wave?this.mat(p.foam?0xedfff9:0x93edee,{roughness:.35}):p.material;
        mesh.visible=wave||!(impact.blocked&&p.wood);
        mesh.position.set(p.dx*(wave?2+p.speed*movingAge*1.6:p.speed*movingAge),(wave?1.1:p.foam?.4:1.8)+p.lift*movingAge*(wave?1.4:1)-5*movingAge*movingAge,p.dz*p.speed*movingAge*(wave?1.5:1));
        const size=(wave?.2:p.foam?.35:.7)*(progress<.6?1:fade*2.5);
        mesh.scale.set(size*(wave?1:p.wood?.45:1),size*(wave?2.2:p.wood?1.8:p.foam?1.4:1),size*(wave?1:p.wood?.25:p.foam?.7:1));
        mesh.rotation.set(p.spin+movingAge*2,movingAge*3,p.spin+movingAge*5);
      }
      if(wave){waveFlash=Math.max(waveFlash,Math.max(0,1-age/.32)*(impact.blocked?.4:1));shake=Math.max(shake,Math.max(0,1-age/.45)*(impact.blocked?.3:1.1));}
      else if(!impact.blocked){flash=Math.max(flash,Math.max(0,1-age/.28));shake=Math.max(shake,Math.max(0,1-age/.38)*(impact.damage||9)/15);}
    }
    this.impactFlash=flash;
    this.waveFlash=this.reducedMotion?0:waveFlash;
    this.impactShake=this.reducedMotion?0:shake*.23;
    this.impactShakeTime=t;
  }

  waterHeight(x,z) {
    return sampleOceanHeight(x,z,this.oceanTime,this.oceanAmplitude);
  }

  projectWorld(x,y,z) {
    this.camera.updateMatrixWorld();
    const projected=this.projectVector.set(-x,y,z).project(this.camera);
    return {x:(projected.x+1)*.5*this.canvas.clientWidth,y:(1-projected.y)*.5*this.canvas.clientHeight,visible:projected.z>-1&&projected.z<1&&Math.abs(projected.x)<1.2&&Math.abs(projected.y)<1.2};
  }

  makeSnackBadge(id) {
    const metadata=ADDONS[id]||ADDONS.bubble;
    if(!this.snackBadges.has(id)) {
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=128;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff8e4';ctx.beginPath();ctx.roundRect(5,5,150,116,24);ctx.fill();
      ctx.lineWidth=7;ctx.strokeStyle=metadata.color;ctx.stroke();
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='52px "Segoe UI Emoji", sans-serif';ctx.fillText(metadata.icon,80,49);
      ctx.fillStyle='#173e59';ctx.font='900 17px system-ui';ctx.fillText(metadata.name.split(' ')[0].toUpperCase(),80,97);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.SpriteMaterial({map:texture,transparent:true,toneMapped:false,depthWrite:false});
      this.snackBadges.set(id,{material,texture});
    }
    const sprite=new THREE.Sprite(this.snackBadges.get(id).material);sprite.position.y=2.3;sprite.scale.set(1.85,1.48,1);return sprite;
  }

  makeSailor(color) {
    const root=new THREE.Group(), body=new THREE.Group(); root.add(body);
    const coat = color || C.gold;
    for(const side of [-1,1]) {
      this.mesh(body,'sphere',C.navy,[side*.21,.15,.07],[.23,.16,.31]);
      this.mesh(body,'cylinder',0x244858,[side*.2,.38,0],[.16,.4,.16]);
    }
    this.mesh(body,'sphere',coat,[0,.82,0],[.52,.56,.37]);
    this.mesh(body,'box',C.cream,[0,.9,.35],[.07,.57,.04]);
    this.mesh(body,'sphere',C.cream,[0,1.19,.05],[.41,.11,.35]);
    const head=this.mesh(body,'sphere',0xffd3a1,[0,1.5,0],[.43,.43,.4]);
    this.mesh(body,'sphere',0xf7b78f,[0,1.46,-.39],[.105,.09,.1]);
    for(const side of [-1,1]) {
      this.mesh(body,'sphere',C.navy,[side*.15,1.55,-.37],[.045,.065,.03]);
      this.mesh(body,'sphere',0xed9986,[side*.25,1.4,-.32],[.085,.045,.035]);
    }
    this.mesh(body,'sphere',C.darkWood,[0,1.31,-.36],[.08,.025,.025]);
    this.mesh(body,'cylinder',C.cream,[0,1.82,0],[.53,.1,.49]);
    this.mesh(body,'sphere',coat,[0,1.92,.02],[.43,.22,.4]);
    this.mesh(body,'box',C.navy,[0,1.87,-.4],[.2,.11,.04]);
    const arms=[];
    for(const side of [-1,1]) {
      const arm=new THREE.Group(); arm.position.set(side*.46,1.05,0); body.add(arm);
      this.mesh(arm,'sphere',coat,[side*.05,-.18,0],[.19,.33,.2]);
      this.mesh(arm,'sphere',0xffd3a1,[side*.08,-.43,-.02],[.17,.18,.17]);
      arms.push(arm);
    }
    const ring=this.mesh(root,'ring',coat,[0,.04,0],[.76,.76,.76],{emissive:coat,emissiveIntensity:.25});
    ring.rotation.x=Math.PI/2; ring.castShadow=false;
    const marker=this.mesh(root,'cone',C.white,[0,2.8,0],[.19,.32,.19]);
    marker.rotation.z=Math.PI;
    const shield=this.mesh(root,'sphere',0xb8fbff,[0,1.1,0],[.9,1.35,.9],{transparent:true,opacity:.16,roughness:.1,depthWrite:false});
    shield.castShadow=false;
    const splash=new THREE.Group(); root.add(splash);
    for(let i=0;i<7;i++) {
      const a=i*TAU/7;
      this.mesh(splash,'sphere',C.white,[Math.cos(a)*.85,.08,Math.sin(a)*.85],[.2,.055,.11]);
    }
    splash.visible=false;
    const rope=this.mesh(this.world,'cylinder',C.cream,[0,0,0],[.045,1,.045]);
    rope.visible=false;
    const effects=this.makePlayerEffects(root);
    root.userData={body,arms,ring,marker,shield,splash,head,rope,effects,lastX:0,lastZ:0,heading:0};
    this.world.add(root);
    return root;
  }

  makeObstacle(type, radius=1, snack='bubble') {
    const g=new THREE.Group();
    if(type==='island') {
      this.makeIslandArt(g,radius);
    } else if(type==='whale') {
      this.mesh(g,'sphere',C.whale,[0,.3,0],[2.4,1.25,4.15]);
      this.mesh(g,'sphere',C.whaleLight,[0,.25,-2.48],[1.8,.79,1.53]);
      this.mesh(g,'sphere',C.whale,[0,.68,-2.5],[2.05,.91,1.49]);
      for(const side of [-1,1]) {
        const fin=this.mesh(g,'sphere',C.whale,[side*2.32,.12,.2],[1.28,.2,.64]); fin.rotation.y=side*.5;
        this.mesh(g,'sphere',C.cream,[side*1.83,.87,-2.38],[.18,.18,.12]);
        this.mesh(g,'sphere',C.navy,[side*1.89,.88,-2.43],[.09,.11,.08]);
        const tail=this.mesh(g,'sphere',C.whale,[side*1.08,1.21,4.1],[1.45,.24,.79]); tail.rotation.z=side*.18; tail.rotation.y=side*.3;
        this.mesh(g,'sphere',C.whaleLight,[side*.65,.32,-3.55],[.53,.08,.08]);
      }
      this.mesh(g,'sphere',C.whale,[0,.65,3.3],[.75,.65,1.5]);
      this.mesh(g,'sphere',C.navy,[0,1.52,-.1],[.2,.04,.3]);
      const spray=new THREE.Group(); spray.position.set(0,1.6,-.1); g.add(spray);
      this.mesh(spray,'cone',0xc8ffff,[0,1.14,0],[.13,2.3,.13],{transparent:true,opacity:.8});
      for(let i=0;i<7;i++) { const a=i*TAU/7; this.mesh(spray,'sphere',0xe7ffff,[Math.cos(a)*.6,2.25+Math.sin(a*3)*.22,Math.sin(a)*.6],[.17,.38,.17]); }
      g.userData.spray=spray;
      g.scale.setScalar(Math.max(.75,Math.min(1.2,radius/2.5)));
    } else if(type==='wreck') {
      const wreck=new THREE.Group(); wreck.rotation.z=.22; wreck.rotation.y=-.38; g.add(wreck);
      this.mesh(wreck,'box',C.darkWood,[0,.23,0],[3.8,.8,5]);
      for(const side of [-1,1]) for(let i=0;i<5;i++) {
        const rib=this.mesh(wreck,'box',i%2?0x895139:0xb5774a,[side*(1.75-.12*i),.55+Math.sin(i)*.24,-2+i*.85],[.18,1.4+i%2*.5,.68]); rib.rotation.z=side*-.18;
      }
      for(let i=0;i<5;i++) this.mesh(wreck,'box',C.wood,[-1.5+i*.7,.71,0],[.52,.12,4.4]);
      this.beam(wreck,[-.4,.6,.5],[.2,4.5,.9],.14,C.darkWood);
      this.beam(wreck,[-1.3,3.3,.8],[1.4,3.3,.8],.09,C.darkWood);
      if(!this.geo.wreckSail) {
        const sail=new THREE.BufferGeometry(); sail.setAttribute('position',new THREE.Float32BufferAttribute([-.9,3.25,.8,1.3,3.25,.8,.8,1.8,.8,.1,2.15,.8,-.4,1.7,.8],3)); sail.setIndex([0,1,2,0,2,3,0,3,4]); sail.computeVertexNormals();
        this.geo.wreckSail=sail;
      }
      this.mesh(wreck,'wreckSail',C.cream,[0,0,0],[1,1,1],{side:THREE.DoubleSide});
      this.mesh(wreck,'ring',C.navy,[1.8,.95,-1.35],[.38,.38,.38]).rotation.y=Math.PI/2;
      g.scale.setScalar(Math.max(.8,radius/2));
    } else if(type==='reef') {
      for(let i=0;i<5;i++) {
        const a=i*2.4, rock=this.mesh(g,'ball',i%2?0x587d81:0x759392,[Math.cos(a)*1.15,.25,Math.sin(a)*1.1],[.75+i%2*.45,.7+(i%3)*.35,.8]);
        rock.rotation.set(i*.3,i,0);
      }
      for(let i=0;i<3;i++) this.mesh(g,'cone',0xf28879,[-1+i,.8,-.4+i*.3],[.22,.8,.22]);
      g.scale.setScalar(Math.max(.7,radius/1.6));
    } else if(type==='supply'||type==='snack'||type==='treasure') {
      const gold=type==='treasure';
      const snackId=typeof snack==='string'?snack:snack?.id||'bubble';
      const pickupColor=type==='snack'?(ADDONS[snackId]||ADDONS.bubble).color:C.coral;
      this.mesh(g,'box',gold?C.gold:C.cream,[0,.65,0],[1.3,.9,1.15]);
      this.mesh(g,'box',gold?C.darkWood:pickupColor,[0,1.12,0],[1.4,.22,1.23]);
      for(const x of [-.42,.42]) this.mesh(g,'box',gold?C.gold:C.navy,[x,.7,-.59],[.13,.84,.05]);
      if(gold) this.mesh(g,'box',C.gold,[0,.8,-.64],[.24,.3,.1]);
      else {
        this.mesh(g,'box',pickupColor,[0,.73,-.605],[.52,.14,.03]);
        this.mesh(g,'box',pickupColor,[0,.73,-.61],[.14,.52,.03]);
      }
      const halo=this.mesh(g,'ring',gold?C.gold:0x91f2d1,[0,.12,0],[1.08,1.08,1.08],{emissive:gold?C.gold:0x64f0c3,emissiveIntensity:.4}); halo.rotation.x=Math.PI/2;
      const sparkle=this.mesh(g,'ball',gold?C.gold:0xb9ffe9,[0,2,0],[.2,.35,.2],{emissive:gold?C.gold:0x64f0c3,emissiveIntensity:.6});
      g.userData.sparkle=sparkle;
      if(type==='snack'){g.add(this.makeSnackBadge(snackId));sparkle.visible=false;}
    } else {
      this.mesh(g,'box',C.wood,[0,.65,0],[1.6,1.4,1.6]);
      for(let side=-1;side<=1;side+=2) {
        for(let i=-1;i<=1;i++) {
          this.mesh(g,'box',C.darkWood,[i*.47,.65,side*.81],[.035,1.3,.03]);
          this.mesh(g,'box',C.darkWood,[side*.81,.65,i*.47],[.03,1.3,.035]);
        }
        for(const y of [.12,1.16]) {
          this.mesh(g,'box',0xcf9459,[0,y,side*.85],[1.72,.18,.1]);
          this.mesh(g,'box',0xcf9459,[side*.85,y,0],[.1,.18,1.72]);
        }
        const brace=this.mesh(g,'box',0xcf9459,[0,.67,side*.87],[1.85,.16,.08]); brace.rotation.z=.62;
      }
      for(const x of [-.53,.53]) this.mesh(g,'box',C.darkWood,[x,1.37,0],[.1,.04,1.65]);
      g.rotation.y=.23;
    }
    // Sparse foam scallops separate every floating silhouette from the water.
    const foam=new THREE.Group(); g.add(foam);
    const size=type==='island'?radius:type==='whale'?3:type==='wreck'?2.4:type==='reef'?1.7:1.1;
    for(let i=0;i<(type==='island'?24:9);i++) {
      const a=i*TAU/(type==='island'?24:9);
      this.mesh(foam,'sphere',0xcdfcf1,[Math.cos(a)*size,.03,Math.sin(a)*size*(type==='island'?.75:1)],[type==='island'?.55:.28,.035,type==='island'?.22:.12]);
    }
    g.userData.type=type; g.userData.foam=foam;
    const animated=[];
    if(g.userData.sparkle) animated.push(g.userData.sparkle);
    if(g.userData.spray) animated.push(...g.userData.spray.children);
    this.batchStatic(g,animated);
    this.world.add(g); return g;
  }

  makeWave() {
    const g=new THREE.Group();
    if(!this.geo.breaker){
      const positions=[],indices=[],colors=[],segments=64,steps=42;
      // A closed, smooth water volume curls over an open pocket on its -Z face.
      // X alone is normalized: width scaling cannot stretch the cross-section.
      const profile=new THREE.CatmullRomCurve3([
        [4.8,-3.2],[3.3,.2],[1.6,3.1],[.1,5.2],[-1.1,6.15],
        [-2.25,5.9],[-2.95,4.8],[-2.7,3.75],[-2.25,4.15],
        [-2.25,4.75],[-1.65,5.05],[-.95,4.15],[-.75,1.3],[-2.,-3.2],
      ].map(([z,y])=>new THREE.Vector3(0,y,z)),true,'catmullrom',.25);
      const back=new THREE.Color(0x023044),face=new THREE.Color(0x087f88),crest=new THREE.Color(0x86e7dc),color=new THREE.Color();
      for(let i=0;i<=segments;i++){
        const u=i/segments,x=u-.5,taper=Math.pow(Math.sin(u*Math.PI),.38)*(.93+.07*Math.sin(u*8)),arc=x*x*7;
        for(let j=0;j<=steps;j++){
          const p=profile.getPoint(j/steps),ripple=(Math.sin(u*26+j*.13)*.09+Math.sin(u*57)*.045)*taper;
          positions.push(x,(p.y+ripple)*taper-.35,p.z*taper+arc);
          color.copy(back).lerp(face,THREE.MathUtils.smoothstep(1.3-p.z,0,2.7));
          color.lerp(crest,THREE.MathUtils.smoothstep(p.y+Math.sin(u*41)*.09,5.85,6.2)*.5);
          colors.push(color.r,color.g,color.b);
        }
      }
      for(let i=0;i<segments;i++)for(let j=0;j<steps;j++){const a=i*(steps+1)+j,b=a+steps+1;indices.push(a,b,a+1,b,b+1,a+1);}
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();this.geo.breaker=geometry;
      // One continuous irregular foam lip, instead of scaled sphere sausages.
      const lip=[],lipIndices=[],sides=8;
      for(let i=0;i<=segments;i++){
        const u=i/segments,x=u-.5,taper=Math.pow(Math.sin(u*Math.PI),.38)*(.93+.07*Math.sin(u*8)),arc=x*x*7,r=(.29+.065*Math.sin(u*71)) * taper;
        for(let j=0;j<=sides;j++){const a=j/sides*TAU;lip.push(x,(5.65+Math.sin(u*26)*.09)*taper-.35+Math.cos(a)*r,(-2.55+Math.sin(a)*r)*taper+arc);}
      }
      for(let i=0;i<segments;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;lipIndices.push(a,b,a+1,b,b+1,a+1);}
      const lipGeo=new THREE.BufferGeometry();lipGeo.setAttribute('position',new THREE.Float32BufferAttribute(lip,3));lipGeo.setIndex(lipIndices);lipGeo.computeVertexNormals();this.geo.breakerLip=lipGeo;
      const streaks=[],streakIndices=[];
      for(let i=0;i<17;i++){
        const u=.045+i*.056,x=u-.5,taper=Math.pow(Math.sin(u*Math.PI),.38)*(.93+.07*Math.sin(u*8)),arc=x*x*7;
        const length=.65+(i%4)*.16,halfWidth=.004+(i%3)*.0015,base=streaks.length/3;
        for(let j=0;j<5;j++){
          const f=j/4,width=halfWidth*(1-f*.85),y=(5.65-f*length)*taper-.35,z=(-2.59-.55*Math.sin(f*Math.PI*.6))*taper+arc;
          streaks.push(x-width+f*.006,y,z,x+width+f*.006,y,z);
          if(j<4){const a=base+j*2;streakIndices.push(a,a+2,a+1,a+1,a+2,a+3);}
        }
      }
      const streakGeo=new THREE.BufferGeometry();streakGeo.setAttribute('position',new THREE.Float32BufferAttribute(streaks,3));streakGeo.setIndex(streakIndices);streakGeo.computeVertexNormals();this.geo.breakerStreaks=streakGeo;
    }
    const body=this.mesh(g,'breaker',C.white,[0,0,0],[1,1,1],{vertexColors:true,side:THREE.DoubleSide,roughness:.48});body.castShadow=false;
    const lip=this.mesh(g,'breakerLip',0xf2fff6,[0,0,0],[1,1,1],{roughness:.55});lip.castShadow=false;
    const streaks=this.mesh(g,'breakerStreaks',0xe8fff4,[0,0,0],[1,1,1],{roughness:.55,side:THREE.DoubleSide});streaks.castShadow=false;
    const spray=new THREE.InstancedMesh(this.geo.sphere,this.mat(0xe1fff8,{roughness:.4}),50);
    spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);spray.frustumCulled=false;g.add(spray);
    g.userData={body,lip,streaks,spray,transform:new THREE.Object3D()};
    this.world.add(g);return g;
  }

  animateWave(object,wave,t) {
    const width=wave.width||22,phase=typeof wave.id==='number'?wave.id:String(wave.id).length;
    const curl=this.reducedMotion?1:1+Math.sin(t*2.8+phase)*.025;
    object.scale.set(width,wave.hit?.82:1,1);
    object.userData.body.scale.y=curl;object.userData.lip.scale.y=curl;
    object.userData.streaks.scale.y=curl;
    const {spray,transform}=object.userData;
    for(let i=0;i<32;i++){
      const u=(i+.5)/32,x=u-.5,taper=Math.pow(Math.sin(u*Math.PI),.38)*(.93+.07*Math.sin(u*8)),arc=x*x*7;
      const age=this.reducedMotion?.3:((t*.85+i*.618+phase*.13)%1);
      transform.position.set(x+Math.sin(i*7)*age*.2/width,(5.7+age*1.8-age*age*4.8)*taper*curl-.35,(-2.6-age*1.5)*taper+arc);
      const size=(.12+(i%3)*.04)*Math.sin(age*Math.PI)*taper;
      transform.scale.set(size/width,size*(1+age*2),size);transform.rotation.x=-.3;transform.updateMatrix();spray.setMatrixAt(i,transform.matrix);
    }
    for(let i=0;i<18;i++){
      const x=(i+.5)/18-.5,z=-2.5+x*x*7;
      const worldX=object.position.x+x*width,worldZ=object.position.z+z;
      transform.position.set(x,(this.waterHeight(worldX,worldZ)-object.position.y+.1)/object.scale.y,z);
      transform.scale.set((.4+(i%3)*.12)/width,.055,.22+(i%2)*.12);transform.rotation.set(0,0,0);transform.updateMatrix();spray.setMatrixAt(i+32,transform.matrix);
    }
    spray.instanceMatrix.needsUpdate=true;
  }

  makeIslandArt(island,radius) {
      // The sand ellipse matches the simulation collider. Tall skirts keep the
      // shore solid while cosmetic swells break around a stationary island.
      const scale=radius/2;
      this.mesh(island,'sphere',0xf4dc9a,[0,-.4,0],[radius,2.15,radius*.75]);
      this.mesh(island,'sphere',0x8abe79,[0,1.05,0],[scale*1.5,1.05,scale]);
      for(let r=0;r<3;r++) { const rock=this.mesh(island,'ball',r%2?0xa5b6a0:0x789b8c,[(r-1)*scale*.7,1.3+r*.2,.4],[scale*.6,scale*(.55+r*.13),scale*.65]); rock.rotation.y=r; }
      for(let p=0;p<2;p++) {
        const x=(p?1:-1)*scale*.55,z=p*1.4-1;
        this.beam(island,[x,1.3,z],[x+.45,5.4,z],.15,C.darkWood);
        for(let leaf=0;leaf<5;leaf++) { const a=leaf*TAU/5; const palm=this.mesh(island,'sphere',leaf%2?0x369a78:0x57b77c,[x+.45+Math.cos(a)*.85,5.35,Math.sin(a)*.85+z],[1.55,.14,.38]); palm.rotation.y=-a; palm.rotation.z=Math.cos(a)*.22; }
        this.mesh(island,'sphere',0xc18b56,[x+.48,5.15,z],[.23,.23,.23]);
      }
  }

  makeScenery() {
    this.buoys=[];
    for(let i=0;i<14;i++) {
      const side=i%2?1:-1;
      const buoy=new THREE.Group();buoy.position.set(side*(15+(i*7)%23),0,i*29-24);
      this.mesh(buoy,'cylinder',C.navy,[0,.04,0],[.5,.18,.5]);
      this.mesh(buoy,'cone',side<0?C.coral:C.cream,[0,.56,0],[.34,1.1,.34]);
      this.mesh(buoy,'sphere',C.gold,[0,1.22,0],[.15,.15,.15]);
      buoy.traverse(object=>{if(object.isMesh)object.castShadow=false;});
      this.world.add(buoy);this.buoys.push({object:buoy,baseZ:i*29-24,offsetX:buoy.position.x,cycle:null});
    }
    this.clouds=[];
    for(let i=0;i<10;i++) {
      const cloud=new THREE.Group();
      for(let n=0;n<4;n++) this.mesh(cloud,'sphere',0xf6ffff,[(n-1.5)*2.6,Math.sin(n*2)*.6,0],[2.7,1.1+(n%2)*.5,1.6]).castShadow=false;
      cloud.position.set((i%2?1:-1)*(28+(i%4)*9),18+(i%3)*3,i*29+30);
      this.batchStatic(cloud,[],false);
      this.world.add(cloud);this.clouds.push({object:cloud,baseZ:i*29+30,offsetX:cloud.position.x,cycle:null});
    }
    this.lighthouse=new THREE.Group();
    this.mesh(this.lighthouse,'sphere',0xefdbab,[0,-.2,0],[6,1,5]);
    this.mesh(this.lighthouse,'cylinder',C.cream,[0,4.2,0],[1.6,8,1.6]);
    for(const y of [2.7,5.7]) this.mesh(this.lighthouse,'cylinder',C.coral,[0,y,0],[1.63,1.1,1.63]);
    this.mesh(this.lighthouse,'cylinder',C.navy,[0,8.1,0],[2,.25,2]);
    this.mesh(this.lighthouse,'cylinder',0x9ae3e0,[0,8.9,0],[1.35,1.5,1.35],{emissive:0xffdf8c,emissiveIntensity:.22});
    for(let i=0;i<6;i++) { const a=i*TAU/6; this.mesh(this.lighthouse,'cylinder',C.navy,[Math.cos(a)*1.35,8.9,Math.sin(a)*1.35],[.07,1.5,.07]); }
    this.mesh(this.lighthouse,'cone',C.coral,[0,10.1,0],[2.05,1.2,2.05]);
    this.mesh(this.lighthouse,'box',C.navy,[0,1.1,-1.6],[.75,1.7,.08]);
    this.lighthouse.position.set(-28,0,500);this.world.add(this.lighthouse);
  }

  makeWake() {
    this.wake=[];
    for(let i=0;i<44;i++) {
      const foam=this.mesh(this.world,'sphere',i%3?0xc1f5e8:C.white,[0,-1,0],[.4,.035,.2]);foam.castShadow=false;
      this.wake.push(foam);
    }
  }

  resize() {
    const width=this.canvas.clientWidth||window.innerWidth, height=this.canvas.clientHeight||window.innerHeight;
    this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;
    this.camera.updateProjectionMatrix();
    this.portrait=width/height<.85;
  }

  removeObject(object) {
    this.world.remove(object);
    object.traverse(child=>{if(child.isInstancedMesh)child.dispose();});
  }

  updateBoatEffects(boat,t) {
    const effects=boat.effects||{},ghost=effects.ghost>0,flash=this.impactFlash||0,waveFlash=this.waveFlash||0;
    for(const item of this.boatMaterials){
      const material=item.material;
      material.color.copy(item.color);
      if(ghost)material.color.lerp(CrewRenderer.GHOST_COLOR,.67);
      if(flash)material.color.lerp(CrewRenderer.FLASH_COLOR,flash*.3);
      if(waveFlash)material.color.lerp(CrewRenderer.WAVE_FLASH_COLOR,waveFlash*.4);
      material.emissive.copy(item.emissive);
      if(ghost)material.emissive.lerp(CrewRenderer.GHOST_COLOR,.5);
      if(flash)material.emissive.lerp(CrewRenderer.FLASH_COLOR,flash*.4);
      if(waveFlash)material.emissive.lerp(CrewRenderer.WAVE_FLASH_COLOR,waveFlash*.3);
      material.emissiveIntensity=item.emissiveIntensity+(ghost?.23:0)+flash*.35+waveFlash*.28;
      if(material.transparent!==ghost){material.transparent=ghost;material.depthWrite=!ghost;material.needsUpdate=true;}
      material.opacity=ghost?.62:1;
    }
    const e=this.boatEffects;
    e.root.position.copy(this.boat.position);e.root.rotation.copy(this.boat.rotation);
    e.tentacles.visible=effects.octopus>0;e.coins.visible=effects.magnet>0;
    e.disco.visible=effects.disco>0;e.thunder.visible=effects.thunder>0;e.ghost.visible=ghost;
    e.coins.rotation.y=t*.9;
    e.coins.children.forEach((coin,i)=>{coin.position.y=1.7+Math.sin(t*3+i)*.35;coin.rotation.z=t*2+i;});
    e.disco.rotation.y=t*.6;
    e.disco.scale.setScalar(1+Math.sin(t*3)*.04);
    e.tentacles.children.forEach((arm,i)=>{arm.rotation.x=Math.sin(t*2+i)*.08;});
    const thunderProgress=1-Math.min(1,(effects.thunder||0)/.8);
    e.thunder.scale.setScalar(this.reducedMotion?1.3:1+thunderProgress*1.8);
    e.ghost.rotation.z=t*.2;
  }

  updateScenery(items,bx,bz,span,behind,animate=false) {
    for(const item of items){
      const cycle=Math.floor((bz-item.baseZ+span-behind)/span);
      if(item.cycle!==cycle||Math.abs(item.object.position.x-bx)>95){item.object.position.x=bx+item.offsetX;item.cycle=cycle;}
      item.object.position.z=item.baseZ+cycle*span;
      if(animate){
        const x=item.object.position.x,z=item.object.position.z;
        item.object.position.y=this.waterHeight(x,z);
        item.object.rotation.x=-(this.waterHeight(x,z+.5)-this.waterHeight(x,z-.5))*.5;
        item.object.rotation.z=(this.waterHeight(x+.5,z)-this.waterHeight(x-.5,z))*.5;
      }
    }
  }

  render(state={}, localId, dt=1/60) {
    const step=Math.min(Math.max(dt||1/60,0),.1);
    this.clock+=step;
    // The simulation still advances normally; only decorative animation freezes.
    // Gameplay roll, position, launches, rescues, and approaching hazards remain visible.
    const t=this.reducedMotion?0:this.clock, boat=state.boat||{}, bx=boat.x||0,bz=boat.z||0;
    this.oceanTime=this.reducedMotion?0:state.presentation?this.clock:(state.time||0);
    this.oceanAmplitude=this.reducedMotion?.25:1;
    const heave=this.waterHeight(bx,bz),speed=boat.speed||0;
    const surfaceRoll=THREE.MathUtils.clamp(Math.atan2(this.waterHeight(bx+3,bz)-this.waterHeight(bx-3,bz),6),-.12,.12);
    const surfacePitch=THREE.MathUtils.clamp(-Math.atan2(this.waterHeight(bx,bz+3)-this.waterHeight(bx,bz-3),6),-.24,.24);
    const roll=(boat.roll||0)+surfaceRoll;
    const pitch=surfacePitch-THREE.MathUtils.clamp((speed-10)*.002,0,.035);
    this.boat.position.set(bx,heave,bz);
    this.boat.rotation.set(pitch,Math.max(-.1,Math.min(.1,-(boat.vx||0)*.007)),roll);
    this.flag.rotation.y=Math.sin(t*6)*.18;
    this.ocean.position.set(bx,0,bz+65);
    this.oceanMaterial.uniforms.uTime.value=this.oceanTime;
    this.oceanMaterial.uniforms.uTravel.value=bz+65;
    this.oceanMaterial.uniforms.uWorldX.value=bx;
    this.oceanMaterial.uniforms.uAmplitude.value=this.oceanAmplitude;
    this.updateImpacts(state,t);
    this.updateBoatEffects(boat,t);
    const aspect=this.camera.aspect;
    const presentation=!!state.presentation;
    const wideMenu=presentation&&this.canvas.clientWidth>720;
    const compactLandscape=!presentation&&aspect>1.4&&this.canvas.clientHeight<=550;
    const distance=presentation?(wideMenu?22:30):compactLandscape?17:aspect<.85?34:27;
    const height=presentation?(wideMenu?25:34):compactLandscape?20:aspect<.85?37:30;
    // World-space offsets must scale with the frustum width: a fixed offset
    // clips the ship in tall desktop side panels despite their large pixel width.
    const offsetX=wideMenu?Math.min(9.2,5.5*aspect):0;
    this.cameraPosition.set(-bx+offsetX,height,bz-distance);
    if(!this.initialized||this.reducedMotion) this.camera.position.copy(this.cameraPosition);
    else this.camera.position.lerp(this.cameraPosition,1-Math.exp(-step*5));
    if(this.impactShake){this.camera.position.x+=Math.sin(this.clock*69)*this.impactShake;this.camera.position.y+=Math.cos(this.clock*83)*this.impactShake*.65;}
    this.cameraTarget.set(-bx+offsetX,0,bz+(presentation?(wideMenu?5:-7):compactLandscape?6:(this.portrait?9:12)));
    this.camera.lookAt(this.cameraTarget);
    this.initialized=true;
    this.sun.position.set(-bx-15,30,bz-20);this.sun.target.position.set(-bx,0,bz);

    const playerIds=new Set();
    for(const player of state.players||[]) {
      playerIds.add(player.id);
      let object=this.playerMeshes.get(player.id);
      if(!object) { object=this.makeSailor(player.color);this.playerMeshes.set(player.id,object); }
      const u=object.userData, px=player.x||0,pz=player.z||0,effects=player.effects||{};
      const deck=!player.state||player.state==='deck';
      const swim=player.state==='swim';
      const y=Number.isFinite(player.y)?player.y:deck?1.8:0;
      const deltaX=px-u.lastX,deltaZ=pz-u.lastZ;
      if(deck&&(Math.abs(deltaX)+Math.abs(deltaZ)>.005)&&Math.abs(deltaX)+Math.abs(deltaZ)<1) u.heading=Math.atan2(-deltaX,-deltaZ);
      u.lastX=px;u.lastZ=pz;
      if(deck){
        object.position.copy(this.tempVector.set(px,y,pz).applyEuler(this.boat.rotation)).add(this.boat.position);
        object.rotation.copy(this.boat.rotation);
      }else{
        const water=this.waterHeight(bx+px,bz+pz);
        const rescueBlend=player.state==='rescue'?THREE.MathUtils.clamp((y-.25)/1.55,0,1):0;
        const floor=player.state==='air'?heave:THREE.MathUtils.lerp(water,heave,rescueBlend);
        object.position.set(bx+px,y+floor,bz+pz);
        object.rotation.set(0,0,this.reducedMotion?0:Math.sin(t*3+px)*.06);
      }
      const giant=effects.giant>0?1.5:1;
      object.scale.setScalar(giant);
      u.body.rotation.y=THREE.MathUtils.lerp(u.body.rotation.y,u.heading,.15);
      u.body.rotation.x=player.brace ? .15 : 0;
      u.body.rotation.z=effects.banana>0?Math.sin(t*8)*.17:0;
      const jellySquash=effects.jelly>0?Math.sin(t*7)*.1:0;
      u.body.scale.set(1-jellySquash*.45,(player.brace ? .76 : swim ? .75 : 1)+jellySquash,1-jellySquash*.45);
      u.body.position.y=deck?Math.abs(Math.sin(t*11))*Math.min(.07,(Math.abs(deltaX)+Math.abs(deltaZ))*1.2):0;
      u.arms[0].rotation.z=player.brace?-.7:deck?Math.sin(t*9)*Math.min(.3,(Math.abs(deltaX)+Math.abs(deltaZ))*3):-1.65+Math.sin(t*8)*.3;
      u.arms[1].rotation.z=player.brace ? .7 : deck ? -u.arms[0].rotation.z : 1.65-Math.sin(t*8)*.3;
      u.ring.visible=deck||swim;u.ring.scale.setScalar(player.id===localId ? .8+Math.sin(t*3)*.03 : .66);
      u.marker.visible=player.id===localId;u.marker.position.y=2.68+Math.sin(t*4)*.12;
      u.shield.visible=!!player.shield||effects.bubble>0;u.shield.rotation.y=t*.5;
      u.splash.visible=swim;u.splash.rotation.y=t*.25;
      if(swim) {u.splash.position.y=(.16-y)/giant;u.ring.position.y=(.18-y)/giant;}
      else u.ring.position.y=.04;
      for(const [name,effect]of Object.entries(u.effects))effect.visible=effects[name]>0;
      u.effects.balloon.rotation.z=Math.sin(t*2)*.07;
      u.effects.disco.rotation.y=t*2;
      u.effects.chili.rotation.y=t*2.4;
      u.effects.magnet.position.y=Math.sin(t*3)*.1;
      u.rope.visible=(player.state==='rescue'&&!player.boarding)||!!player.rescuer;
      if(u.rope.visible) {
        const rescuer=(state.players||[]).find(p=>p.id===player.rescuer);
        const startX=bx+(rescuer?rescuer.x:Math.sign(px)*3.9),startZ=bz+(rescuer?rescuer.z:0),startY=heave+2.4;
        const endX=object.position.x,endY=object.position.y+.8,endZ=object.position.z;
        u.rope.position.set((startX+endX)/2,(startY+endY)/2,(startZ+endZ)/2);
        const dx=endX-startX,dy=endY-startY,dz=endZ-startZ,length=Math.hypot(dx,dy,dz);
        u.rope.scale.y=length;
        if(length>.001) u.rope.quaternion.setFromUnitVectors(CrewRenderer.UP,CrewRenderer.ROPE_DIRECTION.set(dx/length,dy/length,dz/length));
      }
    }
    for(const [id,object] of this.playerMeshes) if(!playerIds.has(id)) {this.world.remove(object,object.userData.rope);this.playerMeshes.delete(id);}

    const obstacleIds=new Set();
    for(const obstacle of state.obstacles||[]) {
      if(obstacle.active===false||obstacle.z<bz-38||obstacle.z>bz+155) continue;
      obstacleIds.add(obstacle.id);
      let object=this.obstacleMeshes.get(obstacle.id);
      if(!object) {object=this.makeObstacle(obstacle.type,obstacle.radius,obstacle.snack);this.obstacleMeshes.set(obstacle.id,object);}
      const phase=typeof obstacle.id==='number'?obstacle.id:String(obstacle.id).length*1.9;
      const ox=obstacle.x||0,oz=obstacle.z||0;
      const grounded=obstacle.type==='island';
      object.position.set(ox,grounded?0:this.waterHeight(ox,oz),oz);
      object.rotation.x=grounded?0:THREE.MathUtils.clamp(-(this.waterHeight(ox,oz+1)-this.waterHeight(ox,oz-1))*.5,-.24,.24);
      object.rotation.z=grounded?0:THREE.MathUtils.clamp((this.waterHeight(ox+1,oz)-this.waterHeight(ox-1,oz))*.5,-.12,.12);
      if(object.userData.spray) {object.userData.spray.scale.y=.8+Math.sin(t*2+phase)*.2;object.userData.spray.rotation.y=t*.35;}
      if(object.userData.sparkle) {object.userData.sparkle.rotation.y=t;object.userData.sparkle.position.y=2+Math.sin(t*3)*.15;}
    }
    for(const [id,object] of this.obstacleMeshes) if(!obstacleIds.has(id)) {this.removeObject(object);this.obstacleMeshes.delete(id);}

    const waveIds=new Set();
    for(const wave of state.waves||[]) {
      if(wave.z<bz-20||wave.z>bz+120) continue;
      waveIds.add(wave.id);
      let object=this.waveMeshes.get(wave.id);
      if(!object) {object=this.makeWave();this.waveMeshes.set(wave.id,object);}
      const wx=wave.x||0,wz=wave.z||0;
      object.position.set(wx,this.waterHeight(wx,wz)-.03,wz);
      object.rotation.set(0,0,0);
      this.animateWave(object,wave,t);
    }
    for(const [id,object] of this.waveMeshes) if(!waveIds.has(id)) {this.removeObject(object);this.waveMeshes.delete(id);}

    for(let i=0;i<this.wake.length;i++) {
      const wakeSpeed=THREE.MathUtils.clamp(speed/10,.65,2.5);
      const age=((t*(1.2+wakeSpeed*.55)+i*.39)%7)/7, side=i%2?1:-1;
      const foam=this.wake[i];
      const fx=bx+side*(3.1+age*(2.5+wakeSpeed))+.35*Math.sin(i*4.1),fz=bz-2.7-age*(12+wakeSpeed*8);
      foam.position.set(fx,this.waterHeight(fx,fz)+.075,fz);
      foam.scale.set((.35+age*.65)*(1-age*.55)*Math.sqrt(wakeSpeed),.045,.15+age*.3*wakeSpeed);
      foam.rotation.y=side*.45;
      foam.visible=(boat.speed||0)>0||state.phase==='lobby';
    }
    this.updateScenery(this.buoys,bx,bz,406,25,true);
    this.updateScenery(this.clouds,bx,bz,290,25);
    const remaining=Math.max(0,(state.duration||180)-(state.time||0));
    this.lighthouse.position.set(bx-28,0,bz+Math.max(20,remaining*Math.max(boat.speed||5,4)));
    this.lighthouse.visible=remaining<32;
    this.renderer.render(this.scene,this.camera);
  }

  destroy() {
    window.removeEventListener('resize',this.onResize);
    const geometries=new Set();
    this.scene.traverse(object=>{if(object.geometry) geometries.add(object.geometry);if(object.isInstancedMesh)object.dispose();});
    for(const geometry of Object.values(this.geo)) geometries.add(geometry);
    for(const geometry of geometries) geometry.dispose();
    for(const material of this.materials.values()) material.dispose();
    for(const item of this.boatMaterials) item.material.dispose();
    for(const slot of this.impactPool) slot.ringMaterial.dispose();
    for(const badge of this.snackBadges.values()){badge.material.dispose();badge.texture.dispose();}
    this.oceanMaterial.dispose();
    this.renderer.dispose();
  }
}

CrewRenderer.UP=new THREE.Vector3(0,1,0);
CrewRenderer.ROPE_DIRECTION=new THREE.Vector3();
CrewRenderer.GHOST_COLOR=new THREE.Color(0xc2d4ff);
CrewRenderer.FLASH_COLOR=new THREE.Color(0xfff4cd);
CrewRenderer.WAVE_FLASH_COLOR=new THREE.Color(0xa3f7ff);
