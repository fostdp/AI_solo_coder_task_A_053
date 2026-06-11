class PorcelainViewer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.porcelainMesh = null;
        this.mergedCrackLines = new MergedCrackLines();
        this.mergedCrackTubes = new MergedCrackTubes();
        this.controls = null;
        this.animationId = null;
        this.autoRotate = false;
        this.showCracks = true;

        this.init();
        this.animate();
    }

    init() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a202c);
        this.scene.fog = new THREE.Fog(0x1a202c, 50, 200);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 30, 50);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.container.appendChild(this.renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);

        const fillLight = new THREE.DirectionalLight(0x63b3ed, 0.3);
        fillLight.position.set(-50, 50, -50);
        this.scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x4fd1c5, 0.5);
        rimLight.position.set(0, 20, -80);
        this.scene.add(rimLight);

        this.initControls();

        const gridHelper = new THREE.GridHelper(100, 20, 0x2d3748, 0x2d3748);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(20);
        this.scene.add(axesHelper);

        window.addEventListener('resize', () => this.onResize());
    }

    initControls() {
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.minDistance = 10;
            this.controls.maxDistance = 200;
            this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
        } else {
            this.isDragging = false;
            this.previousMousePosition = { x: 0, y: 0 };
            this.spherical = { radius: 50, phi: Math.PI / 4, theta: 0 };

            this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
            this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
            this.container.addEventListener('mouseup', () => this.onMouseUp());
            this.container.addEventListener('mouseleave', () => this.onMouseUp());
            this.container.addEventListener('wheel', (e) => this.onWheel(e));
        }
    }

    onMouseDown(e) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onMouseMove(e) {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;

        this.spherical.theta -= deltaX * 0.01;
        this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi + deltaY * 0.01));

        this.updateCameraPosition();
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onMouseUp() {
        this.isDragging = false;
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 1.1 : 0.9;
        this.spherical.radius = Math.max(10, Math.min(200, this.spherical.radius * delta));
        this.updateCameraPosition();
    }

    updateCameraPosition() {
        const x = this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
        const y = this.spherical.radius * Math.cos(this.spherical.phi);
        const z = this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);

        this.camera.position.set(x, y + 20, z);
        this.camera.lookAt(0, 15, 0);
    }

    createPorcelainVase() {
        const points = [];
        for (let i = 0; i < 50; i++) {
            const t = i / 49;
            const y = t * 40;
            let radius;

            if (t < 0.1) {
                radius = 8 - t * 30;
            } else if (t < 0.3) {
                const tt = (t - 0.1) / 0.2;
                radius = 5 + tt * 5;
            } else if (t < 0.7) {
                const tt = (t - 0.3) / 0.4;
                radius = 10 + Math.sin(tt * Math.PI) * 8;
            } else if (t < 0.9) {
                const tt = (t - 0.7) / 0.2;
                radius = 10 - tt * 3;
            } else {
                const tt = (t - 0.9) / 0.1;
                radius = 7 - tt * 2;
            }

            points.push(new THREE.Vector2(Math.max(0.5, radius), y));
        }

        const geometry = new THREE.LatheGeometry(points, 64);
        geometry.computeVertexNormals();

        const material = new THREE.MeshPhysicalMaterial({
            color: 0x1a5f7a,
            metalness: 0.1,
            roughness: 0.2,
            clearcoat: 0.8,
            clearcoatRoughness: 0.1,
            transparent: false,
            opacity: 1.0,
        });

        this.porcelainMesh = new THREE.Mesh(geometry, material);
        this.porcelainMesh.castShadow = true;
        this.porcelainMesh.receiveShadow = true;
        this.scene.add(this.porcelainMesh);

        const baseGeometry = new THREE.CylinderGeometry(7, 9, 2, 64);
        const baseMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x2c3e50,
            metalness: 0.3,
            roughness: 0.4,
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = -1;
        base.castShadow = true;
        base.receiveShadow = true;
        this.scene.add(base);

        return this.porcelainMesh;
    }

    createCrackLine(points, maxDepth = 100) {
        if (points.length < 2) return null;

        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];

        const colorScale = this.getDepthColorScale();

        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const depth = point.depth || 0;

            vertices.push(point.x * 0.1, point.y * 0.1 + 15, point.z * 0.1);

            const color = colorScale(Math.min(depth, 200));
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 3,
            transparent: true,
            opacity: 0.9,
        });

        const line = new THREE.Line(geometry, material);

        const tubeGeometry = new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(points.map(p =>
                new THREE.Vector3(p.x * 0.1, p.y * 0.1 + 15, p.z * 0.1)
            )),
            Math.max(points.length - 1, 1),
            0.3,
            8,
            false
        );

        const tubeMaterial = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.6,
        });

        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);

        const group = new THREE.Group();
        group.add(line);
        group.add(tube);

        return group;
    }

    getDepthColorScale() {
        const stops = [
            { depth: 0, color: { r: 0.19, g: 0.51, b: 0.81 } },
            { depth: 50, color: { r: 0.22, g: 0.63, b: 0.41 } },
            { depth: 100, color: { r: 0.93, g: 0.79, b: 0.29 } },
            { depth: 150, color: { r: 0.93, g: 0.53, b: 0.21 } },
            { depth: 200, color: { r: 0.90, g: 0.24, b: 0.24 } },
        ];

        return (depth) => {
            if (depth <= stops[0].depth) return stops[0].color;
            if (depth >= stops[stops.length - 1].depth) return stops[stops.length - 1].color;

            for (let i = 0; i < stops.length - 1; i++) {
                if (depth >= stops[i].depth && depth <= stops[i + 1].depth) {
                    const t = (depth - stops[i].depth) / (stops[i + 1].depth - stops[i].depth);
                    return {
                        r: stops[i].color.r + (stops[i + 1].color.r - stops[i].color.r) * t,
                        g: stops[i].color.g + (stops[i + 1].color.g - stops[i].color.g) * t,
                        b: stops[i].color.b + (stops[i + 1].color.b - stops[i].color.b) * t,
                    };
                }
            }

            return stops[stops.length - 1].color;
        };
    }

    loadPorcelain(porcelainData, cracksData = []) {
        this.clearScene();
        this.createPorcelainVase();

        if (cracksData.length > 0) {
            this.loadCracks(cracksData);
        }

        if (this.controls) {
            this.controls.target.set(0, 15, 0);
            this.controls.update();
        }
    }

    loadCracks(cracksData) {
        this.clearCracks();

        const cracksWithPoints = cracksData.filter(c => {
            const pts = c.points || c.crack_points || [];
            return pts.length >= 2;
        });

        cracksWithPoints.forEach(crack => {
            this.mergedCrackLines.addCrack(crack);
        });

        this.mergedCrackLines.build(this.scene);

        if (cracksWithPoints.length <= 100) {
            this.mergedCrackTubes.buildFromCracks(cracksWithPoints, this.scene);
        }

        this.mergedCrackLines.setVisible(this.showCracks);
        this.mergedCrackTubes.setVisible(this.showCracks);

        console.log(`[CrackRender] 已加载 ${cracksWithPoints.length} 条裂纹, ` +
                    `顶点=${this.mergedCrackLines.totalVertices}, ` +
                    `线段=${this.mergedCrackLines.totalSegments}, ` +
                    `DrawCall=${this.mergedCrackLines.drawCalls + (this.mergedCrackTubes.mergedMesh ? 1 : 0)}`);
    }

    clearScene() {
        if (this.porcelainMesh) {
            this.scene.remove(this.porcelainMesh);
            this.porcelainMesh.geometry.dispose();
            this.porcelainMesh.material.dispose();
            this.porcelainMesh = null;
        }

        this.clearCracks();
    }

    clearCracks() {
        this.mergedCrackLines.clearFromScene(this.scene);
        this.mergedCrackLines.clear();
        this.mergedCrackTubes.clearFromScene(this.scene);
        this.mergedCrackTubes.clear();
    }

    setShowCracks(show) {
        this.showCracks = show;
        this.mergedCrackLines.setVisible(show);
        this.mergedCrackTubes.setVisible(show);
    }

    setDisplayMode(mode) {
        if (!this.porcelainMesh) return;

        const material = this.porcelainMesh.material;

        switch (mode) {
            case 'solid':
                material.wireframe = false;
                material.transparent = false;
                material.opacity = 1.0;
                break;
            case 'wireframe':
                material.wireframe = true;
                material.transparent = false;
                material.opacity = 1.0;
                break;
            case 'transparent':
                material.wireframe = false;
                material.transparent = true;
                material.opacity = 0.5;
                break;
        }
    }

    setAutoRotate(rotate) {
        this.autoRotate = rotate;
        if (this.controls) {
            this.controls.autoRotate = rotate;
            this.controls.autoRotateSpeed = 1.0;
        }
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        if (this.controls) {
            this.controls.update();
        } else if (this.autoRotate) {
            this.spherical.theta += 0.005;
            this.updateCameraPosition();
        }

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        this.clearScene();

        if (this.mergedCrackLines) {
            this.mergedCrackLines.dispose();
        }
        if (this.mergedCrackTubes) {
            this.mergedCrackTubes.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        window.removeEventListener('resize', () => this.onResize());
    }
}
