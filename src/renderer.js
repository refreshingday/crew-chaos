import * as THREE from 'three';

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
    const geometry = new THREE.PlaneGeometry(240, 320, 70, 100);
    geometry.rotateX(-Math.PI / 2);
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTravel: { value: 0 }, uFog: { value: new THREE.Color(0xb9ebed) } },
      vertexShader: `
        uniform float uTime; uniform float uTravel;
        varying vec3 vPos; varying float vDepth;
        void main() {
          vec3 p = position; float z = p.z + uTravel;
          p.y = sin(p.x*.43 + z*.27 + uTime*1.2)*.18
              + sin(p.x*.8-z*.36+uTime*.8)*.08;
          vec4 world = modelMatrix * vec4(p,1.);
          vPos = vec3(p.x,p.y,z);
          vec4 mv = viewMatrix * world; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uFog;
        varying vec3 vPos; varying float vDepth;
        void main() {
          vec3 normal = normalize(cross(dFdx(vPos), dFdy(vPos)));
          float light = abs(dot(normal, normalize(vec3(-.4,1.,-.6))));
          float colorPatch = sin(vPos.x*.10+vPos.z*.16)*.5+.5;
          vec3 water = mix(vec3(.008,.22,.32),vec3(.025,.5,.47),colorPatch*.65+.2);
          water *= .66+light*.4+normal.x*.22+normal.z*.18;
          float ripple = sin(vPos.x*.63+vPos.z*.48+uTime)*sin(vPos.z*1.3-uTime*.7);
          float glint = smoothstep(.965,1.,ripple)*.32;
          water += vec3(.55,.8,.77)*glint;
          float fog = smoothstep(80.,180.,vDepth);
          gl_FragColor = vec4(mix(water,uFog,fog),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(geometry, this.oceanMaterial);
    this.ocean.position.y = -0.12;
    this.ocean.frustumCulled = false;
    this.world.add(this.ocean);
  }

  makeBoat() {
    const boat = new THREE.Group();
    const outline = [[-3.7,-3.15],[-4.25,-2.6],[-4.4,-1],[-4.1,1.5],[-3.15,2.8],[-1.8,3.65],[0,4.05],[1.8,3.65],[3.15,2.8],[4.1,1.5],[4.4,-1],[4.25,-2.6],[3.7,-3.15]];
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
    root.userData={body,arms,ring,marker,shield,splash,head,rope,lastX:0,lastZ:0,heading:0};
    this.world.add(root);
    return root;
  }

  makeObstacle(type, radius=1) {
    const g=new THREE.Group();
    if(type==='whale') {
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
      this.mesh(g,'box',gold?C.gold:C.cream,[0,.65,0],[1.3,.9,1.15]);
      this.mesh(g,'box',gold?C.darkWood:C.coral,[0,1.12,0],[1.4,.22,1.23]);
      for(const x of [-.42,.42]) this.mesh(g,'box',gold?C.gold:C.navy,[x,.7,-.59],[.13,.84,.05]);
      if(gold) this.mesh(g,'box',C.gold,[0,.8,-.64],[.24,.3,.1]);
      else {
        this.mesh(g,'box',C.coral,[0,.73,-.605],[.52,.14,.03]);
        this.mesh(g,'box',C.coral,[0,.73,-.61],[.14,.52,.03]);
      }
      const halo=this.mesh(g,'ring',gold?C.gold:0x91f2d1,[0,.12,0],[1.08,1.08,1.08],{emissive:gold?C.gold:0x64f0c3,emissiveIntensity:.4}); halo.rotation.x=Math.PI/2;
      const sparkle=this.mesh(g,'ball',gold?C.gold:0xb9ffe9,[0,2,0],[.2,.35,.2],{emissive:gold?C.gold:0x64f0c3,emissiveIntensity:.6});
      g.userData.sparkle=sparkle;
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
    const size=type==='whale'?3:type==='wreck'?2.4:type==='reef'?1.7:1.1;
    for(let i=0;i<9;i++) { const a=i*TAU/9; this.mesh(foam,'sphere',0xcdfcf1,[Math.cos(a)*size,.03,Math.sin(a)*size],[.28,.035,.12]); }
    g.userData.type=type; g.userData.foam=foam;
    const animated=[];
    if(g.userData.sparkle) animated.push(g.userData.sparkle);
    if(g.userData.spray) animated.push(...g.userData.spray.children);
    this.batchStatic(g,animated);
    this.world.add(g); return g;
  }

  makeWave() {
    const g=new THREE.Group();
    const ridge=new THREE.Group();g.add(ridge);
    for(let i=0;i<25;i++) {
      const x=(i-12)*1.8;
      const crest=this.mesh(ridge,'sphere',0x65d7d8,[x,.16,0],[1.38,.53,.78]); crest.castShadow=false;
      const foam=this.mesh(ridge,'sphere',0xe5fff2,[x,.55,-.27],[1.1,.11,.27]); foam.castShadow=false;
      this.mesh(ridge,'sphere',0xabece5,[x+.45,.32,-.65],[.62,.055,.18]).castShadow=false;
    }
    this.batchStatic(ridge,[],false);
    g.userData.ridge=ridge; this.world.add(g); return g;
  }

  makeScenery() {
    this.scenery=[];
    for(let i=0;i<12;i++) {
      const island=new THREE.Group(), side=i%2?1:-1;
      island.position.set(side*(31+(i%3)*9),0,i*28-30);
      const scale=2.6+(i%4)*.7;
      this.mesh(island,'sphere',0xf4dc9a,[0,-.4,0],[scale*2,.85,scale*1.5]);
      this.mesh(island,'sphere',0x8abe79,[0,.17,0],[scale*1.5,.75,scale]);
      for(let r=0;r<3;r++) { const rock=this.mesh(island,'ball',r%2?0xa5b6a0:0x789b8c,[(r-1)*scale*.7,.6+r*.2,.4],[scale*.6,scale*(.55+r*.13),scale*.65]); rock.rotation.y=r; }
      for(let p=0;p<2;p++) {
        const x=(p?1:-1)*scale*.55,z=p*1.4-1;
        this.beam(island,[x,.6,z],[x+.45,4.7,z],.15,C.darkWood);
        for(let leaf=0;leaf<5;leaf++) { const a=leaf*TAU/5; const palm=this.mesh(island,'sphere',leaf%2?0x369a78:0x57b77c,[x+.45+Math.cos(a)*.85,4.65,Math.sin(a)*.85+z],[1.55,.14,.38]); palm.rotation.y=-a; palm.rotation.z=Math.cos(a)*.22; }
        this.mesh(island,'sphere',0xc18b56,[x+.48,4.45,z],[.23,.23,.23]);
      }
      this.batchStatic(island,[],false);
      this.world.add(island);this.scenery.push({object:island,kind:'island',baseZ:i*28-30});
    }
    this.buoys=[];
    for(let i=0;i<22;i++) for(const side of [-1,1]) {
      const buoy=new THREE.Group();buoy.position.set(side*22,0,i*18-24);
      this.mesh(buoy,'cylinder',C.navy,[0,.04,0],[.5,.18,.5]);
      this.mesh(buoy,'cone',side<0?C.coral:C.cream,[0,.56,0],[.34,1.1,.34]);
      this.mesh(buoy,'sphere',C.gold,[0,1.22,0],[.15,.15,.15]);
      buoy.traverse(object=>{if(object.isMesh)object.castShadow=false;});
      this.world.add(buoy);this.buoys.push({object:buoy,baseZ:i*18-24});
    }
    this.clouds=[];
    for(let i=0;i<10;i++) {
      const cloud=new THREE.Group();
      for(let n=0;n<4;n++) this.mesh(cloud,'sphere',0xf6ffff,[(n-1.5)*2.6,Math.sin(n*2)*.6,0],[2.7,1.1+(n%2)*.5,1.6]).castShadow=false;
      cloud.position.set((i%2?1:-1)*(28+(i%4)*9),18+(i%3)*3,i*29+30);
      this.batchStatic(cloud,[],false);
      this.world.add(cloud);this.clouds.push({object:cloud,baseZ:i*29+30});
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

  render(state={}, localId, dt=1/60) {
    const step=Math.min(Math.max(dt||1/60,0),.1);
    this.clock+=step;
    // The simulation still advances normally; only decorative animation freezes.
    // Gameplay roll, position, launches, rescues, and approaching hazards remain visible.
    const t=this.reducedMotion?0:this.clock, boat=state.boat||{}, bx=boat.x||0,bz=boat.z||0;
    const roll=boat.roll||0;
    this.boat.position.set(bx,Math.sin(t*2.2)*.07,bz);
    this.boat.rotation.set(Math.sin(t*1.7)*.012,Math.max(-.1,Math.min(.1,-(boat.vx||0)*.007)),roll);
    this.flag.rotation.y=Math.sin(t*6)*.18;
    this.ocean.position.z=bz+65; this.oceanMaterial.uniforms.uTime.value=t;this.oceanMaterial.uniforms.uTravel.value=bz+65;
    const aspect=this.camera.aspect;
    const presentation=!!state.presentation;
    const wideMenu=presentation&&this.canvas.clientWidth>720;
    const compactLandscape=!presentation&&aspect>1.4&&this.canvas.clientHeight<=550;
    const distance=presentation?(wideMenu?22:30):compactLandscape?17:aspect<.85?34:27;
    const height=presentation?(wideMenu?25:34):compactLandscape?20:aspect<.85?37:30;
    // World-space offsets must scale with the frustum width: a fixed offset
    // clips the ship in tall desktop side panels despite their large pixel width.
    const offsetX=wideMenu?Math.min(9.2,5.5*aspect):0;
    this.cameraPosition.set(-bx*.7+offsetX,height,bz-distance);
    if(!this.initialized||this.reducedMotion) this.camera.position.copy(this.cameraPosition);
    else this.camera.position.lerp(this.cameraPosition,1-Math.exp(-step*5));
    this.cameraTarget.set(-bx*.7+offsetX,0,bz+(presentation?(wideMenu?5:-7):compactLandscape?6:(this.portrait?9:12)));
    this.camera.lookAt(this.cameraTarget);
    this.initialized=true;
    this.sun.position.set(-bx-15,30,bz-20);this.sun.target.position.set(-bx,0,bz);

    const playerIds=new Set();
    for(const player of state.players||[]) {
      playerIds.add(player.id);
      let object=this.playerMeshes.get(player.id);
      if(!object) { object=this.makeSailor(player.color);this.playerMeshes.set(player.id,object); }
      const u=object.userData, px=player.x||0,pz=player.z||0;
      const deck=!player.state||player.state==='deck';
      const swim=player.state==='swim';
      const y=Number.isFinite(player.y)?player.y:deck?1.8:0;
      const deltaX=px-u.lastX,deltaZ=pz-u.lastZ;
      if(deck&&(Math.abs(deltaX)+Math.abs(deltaZ)>.005)&&Math.abs(deltaX)+Math.abs(deltaZ)<1) u.heading=Math.atan2(-deltaX,-deltaZ);
      u.lastX=px;u.lastZ=pz;
      object.position.set(bx+px*Math.cos(roll)-(deck?y:0)*Math.sin(roll),y+(deck?px*Math.sin(roll)+this.boat.position.y:0),bz+pz);
      object.rotation.z=deck?roll:Math.sin(t*3+px)*.09;
      u.body.rotation.y=THREE.MathUtils.lerp(u.body.rotation.y,u.heading,.15);
      u.body.rotation.x=player.brace ? .15 : 0;
      u.body.scale.y=player.brace ? .76 : swim ? .75 : 1;
      u.body.position.y=deck?Math.abs(Math.sin(t*11))*Math.min(.07,(Math.abs(deltaX)+Math.abs(deltaZ))*1.2):0;
      u.arms[0].rotation.z=player.brace?-.7:deck?Math.sin(t*9)*Math.min(.3,(Math.abs(deltaX)+Math.abs(deltaZ))*3):-1.65+Math.sin(t*8)*.3;
      u.arms[1].rotation.z=player.brace ? .7 : deck ? -u.arms[0].rotation.z : 1.65-Math.sin(t*8)*.3;
      u.ring.visible=deck||swim;u.ring.scale.setScalar(player.id===localId ? .8+Math.sin(t*3)*.03 : .66);
      u.marker.visible=player.id===localId;u.marker.position.y=2.68+Math.sin(t*4)*.12;
      u.shield.visible=!!player.shield;u.shield.rotation.y=t*.5;
      u.splash.visible=swim;u.splash.rotation.y=t*.25;
      if(swim) {u.splash.position.y=.16-y;u.ring.position.y=.18-y;}
      else u.ring.position.y=.04;
      u.rope.visible=player.state==='rescue'||!!player.rescuer;
      if(u.rope.visible) {
        const rescuer=(state.players||[]).find(p=>p.id===player.rescuer);
        const startX=bx+(rescuer?rescuer.x:Math.sign(px)*3.9),startZ=bz+(rescuer?rescuer.z:0),startY=2.4;
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
      if(!object) {object=this.makeObstacle(obstacle.type,obstacle.radius);this.obstacleMeshes.set(obstacle.id,object);}
      const phase=typeof obstacle.id==='number'?obstacle.id:String(obstacle.id).length*1.9;
      object.position.set(obstacle.x||0,Math.sin(t*1.7+phase)*.08,obstacle.z||0);
      object.rotation.z=Math.sin(t*1.4+phase)*.035;
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
      object.position.set(0,0,wave.z||0);
      object.rotation.y=(wave.side||1)*.1;
      object.scale.y=wave.hit ? .45 : 1.1+Math.sin(t*3)*.1;
    }
    for(const [id,object] of this.waveMeshes) if(!waveIds.has(id)) {this.removeObject(object);this.waveMeshes.delete(id);}

    for(let i=0;i<this.wake.length;i++) {
      const age=((t*1.6+i*.39)%7)/7, side=i%2?1:-1;
      const foam=this.wake[i];
      foam.position.set(bx+side*(3.1+age*3.4)+Math.sin(i*4.1)*.6,.06+Math.sin(t+i)*.025,bz-2.7-age*18);
      foam.scale.set((.35+age*.65)*(1-age*.55),.03,.15+age*.3);
      foam.rotation.y=side*.45;
      foam.visible=(boat.speed||0)>0||state.phase==='lobby';
    }
    for(const item of this.scenery) item.object.position.z=item.baseZ+Math.floor((bz-item.baseZ+296)/336)*336;
    for(const item of this.buoys) {item.object.position.z=item.baseZ+Math.floor((bz-item.baseZ+371)/396)*396;item.object.rotation.z=Math.sin(t*1.5+item.baseZ)*.1;}
    for(const item of this.clouds) item.object.position.z=item.baseZ+Math.floor((bz-item.baseZ+265)/290)*290;
    const remaining=Math.max(0,(state.duration||180)-(state.time||0));
    this.lighthouse.position.z=bz+Math.max(20,remaining*Math.max(boat.speed||5,4));
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
    this.oceanMaterial.dispose();
    this.renderer.dispose();
  }
}

CrewRenderer.UP=new THREE.Vector3(0,1,0);
CrewRenderer.ROPE_DIRECTION=new THREE.Vector3();
