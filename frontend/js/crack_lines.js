class MergedCrackLines {
    constructor() {
        this.crackData = [];
        this.lineSegments = null;
        this.lineMaterial = null;
        this.boundingBoxes = [];
        this.colorScale = this.buildColorScale();
        this.visible = true;
    }

    buildColorScale() {
        const stops = [
            { depth: 0,    color: new THREE.Color(0x3182ce) },
            { depth: 50,   color: new THREE.Color(0x38a169) },
            { depth: 100,  color: new THREE.Color(0xecc94b) },
            { depth: 150,  color: new THREE.Color(0xed8936) },
            { depth: 200,  color: new THREE.Color(0xe53e3e) }
        ];
        return (depth) => {
            depth = Math.min(Math.max(depth, 0), 200);
            for (let i = 0; i < stops.length - 1; i++) {
                if (depth >= stops[i].depth && depth <= stops[i + 1].depth) {
                    const t = (depth - stops[i].depth) / (stops[i + 1].depth - stops[i].depth);
                    return stops[i].color.clone().lerp(stops[i + 1].color, t);
                }
            }
            return stops[stops.length - 1].color.clone();
        };
    }

    clear() {
        if (this.lineSegments) {
            this.lineSegments.geometry.dispose();
            this.lineSegments = null;
        }
        if (this.lineMaterial) {
            this.lineMaterial.dispose();
            this.lineMaterial = null;
        }
        this.crackData = [];
        this.boundingBoxes = [];
    }

    addCrack(crack) {
        const points = crack.points || crack.crack_points || [];
        if (points.length < 2) return;

        const scaled = points.map(p => ({
            x: (p.x || 0) * 0.1,
            y: (p.y || 0) * 0.1 + 15,
            z: (p.z || 0) * 0.1,
            depth: p.depth || 0,
            width: p.width || 0
        }));

        const bbox = new THREE.Box3();
        scaled.forEach(p => bbox.expandByPoint(new THREE.Vector3(p.x, p.y, p.z)));

        this.crackData.push({
            id: crack.id,
            meta: crack,
            points: scaled,
            bbox: bbox
        });
    }

    build(scene) {
        this.clearFromScene(scene);

        if (this.crackData.length === 0) return;

        const positions = [];
        const colors = [];
        const indices = [];
        let indexOffset = 0;

        this.crackData.forEach(crack => {
            const pts = crack.points;
            const n = pts.length;
            const segStartIndex = indexOffset;

            for (let i = 0; i < n; i++) {
                const p = pts[i];
                positions.push(p.x, p.y, p.z);
                const c = this.colorScale(p.depth);
                colors.push(c.r, c.g, c.b);
            }

            for (let i = 0; i < n - 1; i++) {
                indices.push(
                    segStartIndex + i,
                    segStartIndex + i + 1
                );
            }

            indexOffset += n;
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        this.lineMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false,
            linewidth: 1
        });

        this.lineSegments = new THREE.LineSegments(geometry, this.lineMaterial);
        this.lineSegments.userData.isMergedCracks = true;
        this.lineSegments.visible = this.visible;

        if (scene) scene.add(this.lineSegments);
    }

    clearFromScene(scene) {
        if (this.lineSegments && scene) {
            scene.remove(this.lineSegments);
        }
    }

    setVisible(v) {
        this.visible = v;
        if (this.lineSegments) this.lineSegments.visible = v;
    }

    pickAt(raycaster) {
        if (!this.lineSegments) return null;
        const intersects = raycaster.intersectObject(this.lineSegments, false);
        if (intersects.length === 0) return null;
        const hit = intersects[0];
        let accumulated = 0;
        for (let i = 0; i < this.crackData.length; i++) {
            const segCount = (this.crackData[i].points.length - 1) * 2;
            if (hit.index < accumulated + segCount) {
                return this.crackData[i];
            }
            accumulated += segCount;
        }
        return null;
    }

    get drawCalls() {
        return this.lineSegments ? 1 : 0;
    }

    get totalVertices() {
        let n = 0;
        this.crackData.forEach(c => n += c.points.length);
        return n;
    }

    get totalSegments() {
        let n = 0;
        this.crackData.forEach(c => n += Math.max(0, c.points.length - 1));
        return n;
    }

    dispose() {
        this.clear();
        this.crackData = [];
        this.boundingBoxes = [];
    }
}

class MergedCrackTubes {
    constructor() {
        this.mergedMesh = null;
        this.material = null;
        this.visible = true;
    }

    clear() {
        if (this.mergedMesh) {
            this.mergedMesh.geometry.dispose();
            this.mergedMesh = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
    }

    buildFromCracks(crackData, scene) {
        this.clearFromScene(scene);

        if (!crackData || crackData.length === 0) return;

        const mergedPositions = [];
        const mergedNormals = [];
        const mergedColors = [];
        const mergedIndices = [];
        let indexOffset = 0;

        const colorScale = [
            { d: 0,   r: 0.19, g: 0.51, b: 0.81 },
            { d: 50,  r: 0.22, g: 0.63, b: 0.41 },
            { d: 100, r: 0.93, g: 0.79, b: 0.29 },
            { d: 150, r: 0.93, g: 0.53, b: 0.21 },
            { d: 200, r: 0.90, g: 0.24, b: 0.24 }
        ];
        const sampleColor = (depth) => {
            depth = Math.min(Math.max(depth, 0), 200);
            for (let i = 0; i < colorScale.length - 1; i++) {
                if (depth >= colorScale[i].d && depth <= colorScale[i + 1].d) {
                    const t = (depth - colorScale[i].d) / (colorScale[i + 1].d - colorScale[i].d);
                    return {
                        r: colorScale[i].r + (colorScale[i + 1].r - colorScale[i].r) * t,
                        g: colorScale[i].g + (colorScale[i + 1].g - colorScale[i].g) * t,
                        b: colorScale[i].b + (colorScale[i + 1].b - colorScale[i].b) * t
                    };
                }
            }
            return colorScale[colorScale.length - 1];
        };

        const radialSegments = 6;
        const tubeRadius = 0.15;

        crackData.forEach(crack => {
            const pts = crack.points || crack.crack_points || [];
            if (pts.length < 2) return;
            if (crackData.length > 100) return;

            const curve = new THREE.CatmullRomCurve3(
                pts.map(p => new THREE.Vector3(
                    (p.x || 0) * 0.1,
                    (p.y || 0) * 0.1 + 15,
                    (p.z || 0) * 0.1
                ))
            );
            const tubularSegments = Math.max(pts.length - 1, 1);
            const geo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);

            const posAttr = geo.getAttribute('position');
            const normAttr = geo.getAttribute('normal');
            const indices = geo.index ? geo.index.array : null;

            const avgDepth = (crack.max_depth || crack.maxDepth || 100);
            const col = sampleColor(avgDepth);

            for (let i = 0; i < posAttr.count; i++) {
                mergedPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                mergedNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                mergedColors.push(col.r, col.g, col.b);
            }

            if (indices) {
                for (let i = 0; i < indices.length; i++) {
                    mergedIndices.push(indices[i] + indexOffset);
                }
            } else {
                for (let i = 0; i < posAttr.count; i++) {
                    mergedIndices.push(i + indexOffset);
                }
            }
            indexOffset += posAttr.count;

            geo.dispose();
        });

        if (mergedPositions.length === 0) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNormals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(mergedColors, 3));
        geometry.setIndex(mergedIndices);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        this.material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.mergedMesh = new THREE.Mesh(geometry, this.material);
        this.mergedMesh.userData.isMergedTubes = true;
        this.mergedMesh.visible = this.visible;

        if (scene) scene.add(this.mergedMesh);
    }

    clearFromScene(scene) {
        if (this.mergedMesh && scene) scene.remove(this.mergedMesh);
    }

    setVisible(v) {
        this.visible = v;
        if (this.mergedMesh) this.mergedMesh.visible = v;
    }

    dispose() {
        this.clear();
    }
}
