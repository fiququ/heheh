import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js'
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
    constructor() {
        this.initScene();
        this.initRenderer();
        this.initCamera();
        this.initLighting();
        this.initEventListeners();
        this.loadAssets();
        this.initXR();
    }

    initScene() {
        this.container = document.createElement('div');
        document.body.appendChild(this.container);
        this.scene = new THREE.Scene();
        this.assetsPath = './assets/';
        this.clock = new THREE.Clock();
        this.up = new THREE.Vector3(0, 1, 0);
        this.origin = new THREE.Vector3();
        this.workingVec3 = new THREE.Vector3();
        this.workingQuaternion = new THREE.Quaternion();
        this.raycaster = new THREE.Raycaster();
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.container.appendChild(this.renderer.domElement);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
        this.camera.position.set(0, 1.6, 0);
        this.dolly = new THREE.Object3D();
        this.dolly.position.set(0, 0, 10);
        this.dolly.add(this.camera);
        this.dummyCam = new THREE.Object3D();
        this.camera.add(this.dummyCam);
        this.scene.add(this.dolly);
    }

    initLighting() {
        const ambient = new THREE.HemisphereLight(0xFFFFFF, 0xAAAAAA, 0.8);
        this.scene.add(ambient);
    }

    initEventListeners() {
        window.addEventListener('resize', this.resize.bind(this));
    }

    loadAssets() {
        this.loadingBar = new LoadingBar();
        this.stats = new Stats();
        this.container.appendChild(this.stats.dom);

        fetch('./college.json')
            .then(response => response.json())
            .then(data => {
                this.boardData = data;
                this.boardShown = '';
                this.loadCollege();
            })
            .catch(error => console.error('Error loading college.json:', error));
    }

    setEnvironment() {
        const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        loader.load('./assets/hdr/venice_sunset_1k.hdr', (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            pmremGenerator.dispose();
            this.scene.environment = envMap;
        }, undefined, (err) => {
            console.error('Error setting environment:', err);
        });
    }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    loadCollege() {
        const loader = new GLTFLoader().setPath(this.assetsPath);
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('./libs/three/js/draco/');
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            'college.glb',
            (gltf) => {
                this.onCollegeLoaded(gltf);
                this.loadingBar.visible = false;
                this.setupXR();
            },
            (xhr) => {
                this.loadingBar.progress = (xhr.loaded / xhr.total);
            },
            (error) => {
                console.error('Error loading college.glb:', error);
            }
        );
    }

    onCollegeLoaded(gltf) {
        const college = gltf.scene.children[0];
        this.scene.add(college);

        college.traverse((child) => {
            if (child.isMesh) {
                this.processMeshChild(child);
            }
        });

        this.setUpLobbyShop(college);
    }

    processMeshChild(child) {
        if (child.name.includes("PROXY")) {
            child.material.visible = false;
            this.proxy = child;
        } else if (child.material.name.includes('Glass')) {
            child.material.opacity = 0.1;
            child.material.transparent = true;
        } else if (child.material.name.includes("SkyBox")) {
            const mat1 = child.material;
            const mat2 = new THREE.MeshBasicMaterial({ map: mat1.map });
            child.material = mat2;
            mat1.dispose();
        }
    }

    setUpLobbyShop(college) {
        const door1 = college.getObjectByName("LobbyShop_Door__1_");
        const door2 = college.getObjectByName("LobbyShop_Door__2_");
        const pos = door1.position.clone().sub(door2.position).multiplyScalar(0.5).add(door2.position);
        const obj = new THREE.Object3D();
        obj.name = "LobbyShop";
        obj.position.copy(pos);
        college.add(obj);
    }

    initXR() {
        this.renderer.xr.enabled = true;
        new VRButton(this.renderer);
    }

    setupXR() {
        this.controllers = this.buildControllers(this.dolly);

        this.controllers.forEach((controller) => {
            controller.addEventListener('selectstart', this.onSelectStart.bind(this));
            controller.addEventListener('selectend', this.onSelectEnd.bind(this));
            controller.addEventListener('connected', this.onConnected.bind(this));
        });

        this.ui = new CanvasUI({ name: "name", info: "info" }, {
            panelSize: { height: 0.5 },
            height: 256,
            name: { fontSize: 50, height: 70 },
            info: { position: { top: 70, backgroundColor: "#ccc", fontColor: "#000" } }
        });
        this.scene.add(this.ui.mesh);
        this.renderer.setAnimationLoop(this.render.bind(this));

        setTimeout(() => {
            if (!this.controllers[0].userData.connected && !this.controllers[1].userData.connected) {
                this.useGaze = true;
                this.gazeController = new GazeController(this.scene, this.dummyCam);
            }
        }, 2000);
    }

    buildControllers(parent = this.scene) {
        const controllerModelFactory = new XRControllerModelFactory();
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const line = new THREE.Line(geometry);
        line.scale.z = 0;

        return [0, 1].map((i) => {
            const controller = this.renderer.xr.getController(i);
            controller.add(line.clone());
            controller.userData.selectPressed = false;
            parent.add(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(controllerModelFactory.createControllerModel(grip));
            parent.add(grip);

            return controller;
        });
    }

    onSelectStart(event) {
        event.target.userData.selectPressed = true;
    }

    onSelectEnd(event) {
        event.target.userData.selectPressed = false;
    }

    onConnected(event) {
        event.target.userData.connected = true;
    }

    moveDolly(dt) {
        if (!this.proxy) return;

        const wallLimit = 1.3;
        const speed = 2;
        const pos = this.dolly.position.clone().add(new THREE.Vector3(0, 1, 0));

        const dir = new THREE.Vector3();
        const quaternion = this.dolly.quaternion.clone();
        this.dolly.quaternion.copy(this.dummyCam.getWorldQuaternion(this.workingQuaternion));
        this.dolly.getWorldDirection(dir).negate();

        this.raycaster.set(pos, dir);

        if (this.raycaster.intersectObject(this.proxy).length === 0) {
            this.dolly.translateZ(-dt * speed);
        }

        this.dolly.quaternion.copy(quaternion);
    }

    get selectPressed() {
        return this.controllers && (this.controllers[0].userData.selectPressed || this.controllers[1].userData.selectPressed);
    }

    showInfoboard(name, info, pos) {
        if (!this.ui) return;

        this.ui.position.copy(pos).add(this.workingVec3.set(0, 1.3, 0));
        this.ui.updateElement('name', info.name);
        this.ui.updateElement('info', info.info);
        this.ui.update();
        this.ui.lookAt(this.dummyCam.getWorldPosition(this.workingVec3));
        this.ui.visible = true;
        this.boardShown = name;
    }

    render() {
        const dt = this.clock.getDelta();

        if (this.renderer.xr.isPresenting) {
            if (this.selectPressed || (this.useGaze && this.gazeController && this.gazeController.mode === GazeController.Modes.MOVE)) {
                this.moveDolly(dt);

                if (this.boardData) {
                    const dollyPos = this.dolly.getWorldPosition(new THREE.Vector3());
                    let boardFound = false;

                    Object.entries(this.boardData).forEach(([name, info]) => {
                        const obj = this.scene.getObjectByName(name);
                        if (obj && dollyPos.distanceTo(obj.getWorldPosition(new THREE.Vector3())) < 3) {
                            boardFound = true;
                            if (this.boardShown !== name) {
                                this.showInfoboard(name, info, obj.getWorldPosition(new THREE.Vector3()));
                            }
                        }
                    });

                    if (!boardFound) {
                        this.boardShown = "";
                        this.ui.visible = false;
                    }
                }
            }
        }

        if (this.immersive !== this.renderer.xr.isPresenting) {
            this.resize();
            this.immersive = this.renderer.xr.isPresenting;
        }

        this.stats.update();
        this.renderer.render(this.scene, this.camera);
    }
}

export { App };
