// Vanilla-JS port of MeshGradientWebGL. The React wrapper (hooks, JSX) is
// gone since this site has no React/build step, but the WebGL rendering
// logic (WebGLManager + animation math) is unchanged from the source.

function hexToRgb01(hex) {
  const m = hex.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return [1, 1, 1];
  let c = m[1];
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length === 6) c += 'ff';
  const num = parseInt(c, 16);
  return [(num >> 24) & 255, (num >> 16) & 255, (num >> 8) & 255].slice(-3).map((v) => v / 255);
}

const MAX_POINTS = 7;

class WebGLManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.uniforms = {};
    this.isValid = false;
  }

  init() {
    try {
      this.gl =
        this.canvas.getContext('webgl', { alpha: false, antialias: true, depth: false, stencil: false }) ||
        this.canvas.getContext('experimental-webgl', { alpha: false, antialias: true, depth: false, stencil: false });

      if (!this.gl) throw new Error('WebGL not supported');

      this.gl.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.isValid = false;
      });
      this.gl.canvas.addEventListener('webglcontextrestored', () => {
        this.init();
        this.createShaders();
        this.createBuffers();
      });

      this.gl.getError();
      this.gl.clearColor(0, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      if (this.gl.getError() !== this.gl.NO_ERROR) throw new Error('WebGL context test failed');

      this.isValid = true;
      return true;
    } catch (error) {
      console.warn('WebGL initialization failed:', error);
      this.isValid = false;
      return false;
    }
  }

  compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createShaders() {
    if (!this.gl || !this.isValid) return false;
    try {
      const vertexShaderSource = `
        attribute vec2 a_position;
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `;

      const fragmentShaderSource = `
        precision mediump float;
        uniform vec2 u_points[${MAX_POINTS}];
        uniform vec3 u_colors[${MAX_POINTS}];
        uniform int u_numPoints;
        uniform vec2 u_resolution;

        void main() {
          vec2 uv = gl_FragCoord.xy / u_resolution;
          vec3 color = vec3(0.0);
          float total = 0.0;
          float sharpness;
          if (u_numPoints == 2) {
            sharpness = 2.2;
          } else if (u_numPoints <= 4) {
            sharpness = 7.0;
          } else if (u_numPoints <= 6) {
            sharpness = 8.0;
          } else {
            sharpness = 9.0;
          }
          for (int i = 0; i < ${MAX_POINTS}; i++) {
            if (i < u_numPoints) {
              float d = distance(uv, u_points[i]);
              float w = (u_numPoints == 2) ? exp(-d * d * sharpness) : exp(-d * sharpness);
              color += u_colors[i] * w;
              total += w;
            }
          }
          if (total > 0.0) color /= total;
          gl_FragColor = vec4(color, 1.0);
        }
      `;

      const vertexShader = this.compileShader(this.gl, this.gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = this.compileShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShaderSource);
      if (!vertexShader || !fragmentShader) throw new Error('Shader compilation failed');

      this.program = this.gl.createProgram();
      this.gl.attachShader(this.program, vertexShader);
      this.gl.attachShader(this.program, fragmentShader);
      this.gl.linkProgram(this.program);
      if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
        throw new Error('Program linking failed: ' + this.gl.getProgramInfoLog(this.program));
      }

      this.uniforms = {
        points: this.gl.getUniformLocation(this.program, 'u_points'),
        colors: this.gl.getUniformLocation(this.program, 'u_colors'),
        numPoints: this.gl.getUniformLocation(this.program, 'u_numPoints'),
        resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
      };

      this.gl.deleteShader(vertexShader);
      this.gl.deleteShader(fragmentShader);
      return true;
    } catch (error) {
      console.error('Shader creation failed:', error);
      this.isValid = false;
      return false;
    }
  }

  createBuffers() {
    if (!this.gl || !this.isValid) return false;
    try {
      this.buffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
      const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
      return true;
    } catch (error) {
      console.error('Buffer creation failed:', error);
      this.isValid = false;
      return false;
    }
  }

  render(points, colors, numPoints, width, height) {
    if (!this.gl || !this.isValid || !this.program || !this.buffer) return false;
    try {
      this.gl.viewport(0, 0, width, height);
      this.gl.useProgram(this.program);
      this.gl.uniform2fv(this.uniforms.points, points);
      this.gl.uniform3fv(this.uniforms.colors, colors);
      this.gl.uniform1i(this.uniforms.numPoints, numPoints);
      this.gl.uniform2f(this.uniforms.resolution, width, height);

      const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
      this.gl.enableVertexAttribArray(positionLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
      this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      return true;
    } catch (error) {
      console.error('Render failed:', error);
      this.isValid = false;
      return false;
    }
  }

  cleanup() {
    if (this.gl) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.isValid = false;
  }
}

function createMeshGradient(canvas, { colors = [], numPoints = 2 } = {}) {
  const manager = new WebGLManager(canvas);
  if (!manager.init() || !manager.createShaders() || !manager.createBuffers()) {
    manager.cleanup();
    return null;
  }

  const n = Math.min(colors.length, numPoints, MAX_POINTS);
  const colorArray = colors.map(hexToRgb01);
  while (colorArray.length < MAX_POINTS) colorArray.push(colorArray[colorArray.length - 1] || [1, 1, 1]);

  let width = 0;
  let height = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.floor(window.innerWidth * dpr);
    height = Math.floor(window.innerHeight * dpr);
    canvas.width = width;
    canvas.height = height;
  }
  resize();
  window.addEventListener('resize', resize);

  let animationId = null;
  function frame() {
    const t = performance.now() * 0.0012;
    let points = [];

    if (n === 2) {
      const baseAngle = Math.PI / 4;
      const baseR = 0.22;
      const t1 = t * 0.7;
      const t2 = t * 0.9 + Math.PI / 2;
      const angle1 = baseAngle + Math.sin(t1) * 1.2 + Math.cos(t1 * 0.5) * 0.7;
      const r1 = baseR + Math.sin(t1 * 0.8) * 0.07 + Math.cos(t1 * 0.3) * 0.04;
      const angle2 = baseAngle + Math.PI + Math.cos(t2) * 1.2 + Math.sin(t2 * 0.5) * 0.7;
      const r2 = baseR + Math.cos(t2 * 0.8) * 0.07 + Math.sin(t2 * 0.3) * 0.04;
      points = [
        0.5 + Math.cos(angle1) * r1, 0.5 + Math.sin(angle1) * r1,
        0.5 + Math.cos(angle2) * r2, 0.5 + Math.sin(angle2) * r2,
      ];
    } else {
      const globalBreath = 0.13 + 0.07 * Math.sin(t * 0.23);
      for (let i = 0; i < n; i++) {
        const angleBase = (i / n) * Math.PI * 2;
        const angle =
          angleBase +
          Math.sin(t * (0.7 + i * 0.13) + i) * 0.38 +
          Math.sin(t * (0.23 + i * 0.07) + i * 1.7) * 0.18;
        const radius =
          0.32 +
          0.08 * Math.sin(i * 2.1) +
          Math.cos(t * (0.6 + i * 0.11) + i * 0.8) * 0.09 +
          Math.sin(t * (0.19 + i * 0.09) + i * 2.2) * 0.04 +
          globalBreath;
        points.push(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
      }
    }

    while (points.length < MAX_POINTS * 2) points.push(0, 0);

    const ok = manager.render(points, colorArray.flat(), n, width, height);
    if (ok) {
      animationId = requestAnimationFrame(frame);
    }
  }
  frame();

  return {
    destroy() {
      if (animationId) cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      manager.cleanup();
    },
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('mesh-gradient-canvas');
  if (!canvas) return;

  const result = createMeshGradient(canvas, {
    colors: ['#2c2c54', '#91efb1', '#7371fc', '#abe6e6', '#ff8aa6', '#92caa5'],
    numPoints: 6,
  });

  if (!result) {
    // WebGL unavailable: hide the canvas and let the CSS mesh-gradient
    // fallback on body.home show through instead.
    canvas.style.display = 'none';
  }
});
